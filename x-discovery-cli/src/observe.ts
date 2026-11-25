import { chromium } from "playwright";
import { Schema } from "effect";
import { join } from "node:path";
import { writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { deriveRecipe, type Observation } from "../../x-client-core/src/recipe.ts";
import { delay } from "../../x-archive-core/src/collector.ts";

interface ObservationPage {
  url?: string;
  label: string;
  scroll?: boolean;
  reusePage?: boolean;
}

const PAGES: Record<string, readonly ObservationPage[]> = {
  HomeTimeline: [
    { url: "https://x.com/home", label: "initial", scroll: true },
    { label: "continuation", reusePage: true },
    { url: "https://x.com/home", label: "fresh-run" },
  ],
  Following: [
    { url: "https://x.com/i/user/{userId}/following", label: "initial", scroll: true },
    { label: "continuation", reusePage: true },
    { url: "https://x.com/i/user/{userId}/following", label: "fresh-run" },
  ],
  Followers: [
    { url: "https://x.com/i/user/{userId}/followers", label: "initial", scroll: true },
    { label: "continuation", reusePage: true },
    { url: "https://x.com/i/user/{userId}/followers", label: "fresh-run" },
  ],
};

const SEMANTIC_NAMES: Record<string, string> = {
  HomeTimeline: "home.page",
  Following: "social.following",
  Followers: "social.followers",
};

const ValuesSchema = Schema.Record(Schema.String, Schema.Unknown);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return Schema.decodeUnknownSync(ValuesSchema)(parsed) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseValues(url: URL, postData: string | undefined): Record<string, unknown> {
  const body = parseObject(postData ?? null);
  if (Object.keys(body).length > 0) {
    return { ...parseObject(JSON.stringify(body["variables"] ?? {})), ...body };
  }
  return parseObject(url.searchParams.get("variables"));
}

export interface RecordedExchange {
  method: string;
  path: string;
  values: Record<string, unknown>;
  cursors: string[];
  responseKeys: string[];
  headers: Record<string, string>;
  label?: string;
}

export function extractCursorValues(body: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = object(value);
    if (!record) return;
    if (typeof record["cursorType"] === "string" && typeof record["value"] === "string") {
      found.add(record["value"]);
    }
    if (typeof record["entryId"] === "string" && record["entryId"].startsWith("cursor-")) {
      const cursor = get(record, "content", "value");
      if (typeof cursor === "string") found.add(cursor);
    }
    Object.values(record).forEach(visit);
  };
  visit(body);
  return [...found];
}

function get(value: unknown, ...keys: string[]): unknown {
  let result = value;
  for (const key of keys) result = object(result)?.[key];
  return result;
}

export function selectExchange(
  exchanges: readonly RecordedExchange[],
  consumed: ReadonlySet<number>,
  dependencyCursors?: readonly string[],
): number | null {
  for (let index = 0; index < exchanges.length; index++) {
    if (consumed.has(index)) continue;
    if (dependencyCursors === undefined) return index;
    const cursor = exchanges[index]?.values["cursor"];
    if (typeof cursor === "string" && dependencyCursors.includes(cursor)) return index;
  }
  return null;
}

async function waitForExchange(
  exchanges: readonly RecordedExchange[],
  consumed: ReadonlySet<number>,
  signal: AbortSignal,
  settle: () => Promise<void>,
  dependencyCursors?: readonly string[],
): Promise<number | null> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (signal.aborted) throw new Error("Interrupted while observing the continuation.");
    await settle();
    const selected = selectExchange(exchanges, consumed, dependencyCursors);
    if (selected !== null) return selected;
    if (Date.now() >= deadline) return null;
    await delay(500, signal);
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
  const steps = PAGES[options.operation];
  if (!steps) throw new Error("No observation recipe for " + options.operation + ".");
  const browser = await chromium.connectOverCDP(options.cdpUrl, { timeout: 30_000 });
  const observations: Observation[] = [];
  const persistObservations = (): void => {
    writeJsonFile(join(options.outDir, "observations", options.operation + ".json"), observations, 0o644);
  };
  let pending: Promise<void>[] = [];
  const track = (task: Promise<void>): void => { pending.push(task); };
  const settle = async (): Promise<void> => {
    if (pending.length === 0) return;
    const tasks = pending;
    pending = [];
    await Promise.allSettled(tasks);
  };
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + options.cdpUrl + " has no page context.");
    let page: Awaited<ReturnType<typeof context.newPage>> | null = null;
    let exchanges: RecordedExchange[] = [];
    const consumed = new Set<number>();
    for (const spec of steps) {
      if (options.signal.aborted) throw new Error("Interrupted while observing " + options.operation + ".");
      if (!spec.reusePage || page === null) {
        await settle();
        if (page) await page.close().catch(() => {});
        page = await context.newPage();
        exchanges = [];
        consumed.clear();
        const pageExchanges = exchanges;
        page.on("response", (response) => {
          const task = (async () => {
            try {
              const parsed = new URL(response.url());
              if (!parsed.pathname.endsWith("/" + options.operation)) return;
              const request = response.request();
              const values = parseValues(parsed, request.postData() ?? undefined);
              let body: unknown = null;
              try {
                body = await response.json();
              } catch { /* Response bodies are optional for shape comparison. */ }
              const data = object(body)?.["data"];
              const shape = object(data) ?? object(body) ?? {};
              const headers: Record<string, string> = {};
              for (const name of Object.keys(request.headers())) headers[name] = "<present>";
              pageExchanges.push({
                method: request.method(),
                path: parsed.pathname,
                values,
                cursors: extractCursorValues(body),
                responseKeys: Object.keys(shape),
                headers,
              });
            } catch { /* Ignore responses that are not X GraphQL observations. */ }
          })();
          track(task);
        });
        const url = (spec.url ?? "").replace("{userId}", options.accountId ?? "");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        if (spec.scroll) {
          await delay(3000, options.signal);
          await page.mouse.wheel(0, 6000);
          await delay(2500, options.signal);
        }
      }
      const dependencyCursors = spec.reusePage
        ? [...consumed].flatMap((index) => exchanges[index]?.cursors ?? [])
        : undefined;
      const selected = await waitForExchange(exchanges, consumed, options.signal, settle, dependencyCursors);
      if (selected === null) {
        persistObservations();
        throw new Error(
          "Incomplete observation: no " + options.operation + " request on " + spec.label
          + (spec.reusePage ? " used a cursor from the preceding response. Pagination was not observed." : "."),
        );
      }
      consumed.add(selected);
      const exchange = exchanges[selected]!;
      observations.push({
        label: spec.label,
        method: exchange.method,
        path: exchange.path,
        values: exchange.values,
        responseKeys: exchange.responseKeys,
        headers: exchange.headers,
        ...(spec.reusePage ? { continuationOf: "initial" } : {}),
      });
    }
    await settle();
    if (page) await page.close().catch(() => {});
  } catch (error) {
    persistObservations();
    throw error;
  } finally {
    await settle().catch(() => {});
    await browser.close();
  }
  persistObservations();
  if (observations.length === 0) throw new Error("X did not emit " + options.operation + " during observation.");
  const recipe = deriveRecipe(options.operation, SEMANTIC_NAMES[options.operation] ?? options.operation, observations);
  const recipePath = join(options.outDir, "recipes", options.operation + ".json");
  writeJsonFile(recipePath, recipe, 0o644);
  return { observations, recipePath };
}
