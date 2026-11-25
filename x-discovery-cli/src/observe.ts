import { chromium } from "playwright";
import { join } from "node:path";
import { writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { deriveRecipe, type Observation } from "../../x-client-core/src/recipe.ts";

interface ObservationPage {
  url: string;
  label: string;
  scroll?: boolean;
}

const PAGES: Record<string, readonly ObservationPage[]> = {
  HomeTimeline: [
    { url: "https://x.com/home", label: "initial" },
    { url: "https://x.com/home", label: "continuation", scroll: true },
    { url: "https://x.com/home", label: "fresh-run" },
  ],
  Following: [
    { url: "https://x.com/i/user/{userId}/following", label: "initial" },
    { url: "https://x.com/i/user/{userId}/following", label: "continuation", scroll: true },
    { url: "https://x.com/i/user/{userId}/following", label: "fresh-run" },
  ],
  Followers: [
    { url: "https://x.com/i/user/{userId}/followers", label: "initial" },
    { url: "https://x.com/i/user/{userId}/followers", label: "fresh-run" },
  ],
};

const SEMANTIC_NAMES: Record<string, string> = {
  HomeTimeline: "home.page",
  Following: "social.following",
  Followers: "social.followers",
};

function parseValues(url: URL, postData: string | undefined): Record<string, unknown> {
  const body = postData ? JSON.parse(postData) as Record<string, unknown> : null;
  if (body && typeof body === "object") {
    return { ...(body["variables"] as Record<string, unknown> ?? {}), ...body };
  }
  const raw = url.searchParams.get("variables");
  try {
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function observeOperation(options: {
  operation: string;
  cdpUrl: string;
  accountId?: string;
  outDir: string;
  signal: AbortSignal;
  onStatus?: (message: string) => void;
}): Promise<{ observations: Observation[]; recipePath: string }> {
  const pages = PAGES[options.operation];
  if (!pages) throw new Error("No observation recipe for " + options.operation + ".");
  const browser = await chromium.connectOverCDP(options.cdpUrl, { timeout: 30_000 });
  const observations: Observation[] = [];
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + options.cdpUrl + " has no page context.");
    for (let index = 0; index < pages.length; index++) {
      if (options.signal.aborted) throw new Error("Interrupted while observing " + options.operation + ".");
      const spec = pages[index]!;
      const url = spec.url.replace("{userId}", options.accountId ?? "");
      const page = await context.newPage();
      try {
        let captured: Observation | null = null;
        page.on("response", async (response) => {
          const parsed = new URL(response.url());
          if (!captured || !parsed.pathname.endsWith("/" + options.operation)) return;
          try {
            const body = await response.json() as Record<string, unknown>;
            captured.responseKeys = Object.keys(body["data"] ?? body);
          } catch { /* Response bodies are optional for shape comparison. */ }
        });
        page.on("request", (request) => {
          if (captured) return;
          const parsed = new URL(request.url());
          if (!parsed.pathname.endsWith("/" + options.operation)) return;
          const values = parseValues(parsed, request.postData() ?? undefined);
          const headers: Record<string, string> = {};
          for (const name of Object.keys(request.headers())) headers[name] = "<present>";
          captured = {
            label: spec.label,
            method: request.method(),
            path: parsed.pathname,
            values,
            responseKeys: [],
            headers,
          };
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        if (spec.scroll) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await page.mouse.wheel(0, 6000);
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        const deadline = Date.now() + 15_000;
        while (!captured && Date.now() < deadline) {
          if (options.signal.aborted) throw new Error("Interrupted while observing " + options.operation + ".");
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (captured) observations.push(captured);
        else options.onStatus?.("No " + options.operation + " request on observation " + (index + 1) + ".");
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  if (observations.length === 0) throw new Error("X did not emit " + options.operation + " during observation.");
  const recipe = deriveRecipe(options.operation, SEMANTIC_NAMES[options.operation] ?? options.operation, observations);
  const recipePath = join(options.outDir, "recipes", options.operation + ".json");
  const observationPath = join(options.outDir, "observations", options.operation + ".json");
  writeJsonFile(observationPath, observations, 0o644);
  writeJsonFile(recipePath, recipe, 0o644);
  return { observations, recipePath };
}
