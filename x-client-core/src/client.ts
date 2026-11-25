import { chromium } from "playwright";
import { cookieSession, readBrowserSession } from "../../lib/x-session.ts";
import { resolveBackend } from "../../x-archive-cli/src/backend.ts";
import { readCapturedCredentials, type RequiredCaptures } from "../../x-archive-cli/src/deps.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { requestWithRetry } from "../../x-archive-core/src/collector.ts";
import {
  captureRequest,
  mergeCapture,
  type Credentials,
  type Operation,
} from "../../x-archive-core/src/capture.ts";
import { parseHomeTimeline, type ParsedHomeTimeline } from "../../x-discovery-core/src/parser.ts";
import type { DiscoveredPost } from "../../x-discovery-core/src/post.ts";
import type { Feed } from "../../x-discovery-core/src/observation.ts";

export interface ConnectXOptions {
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  expectedAccountId?: string | undefined;
  required?: RequiredCaptures | undefined;
  feed?: Feed | undefined;
  signal?: AbortSignal | undefined;
  onStatus?: ((message: string) => void) | undefined;
}

export interface HomePage {
  result: ParsedHomeTimeline;
  raw: unknown;
}

export interface XClient {
  accountId: string;
  request(operation: Operation, variables: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  homePage(continuation: string | null, signal: AbortSignal): Promise<HomePage>;
  feed: Feed;
}

export function operationForFeed(feed: Feed): "HomeTimeline" | "HomeLatestTimeline" {
  return feed === "home-following" ? "HomeLatestTimeline" : "HomeTimeline";
}

function homeVariables(continuation: string | null): Record<string, unknown> {
  return {
    count: 20,
    includePromotedContent: true,
    requestContext: "launch",
    withCommunity: true,
    ...(continuation === null ? {} : { cursor: continuation }),
  };
}

function cachedCredentials(): Credentials {
  const raw = readJsonFile(credentialsCachePath());
  if (!raw || typeof raw !== "object") return { queryIds: {}, features: {} };
  const { cached_at: _cached, ...rest } = raw as Record<string, unknown>;
  return {
    ...(rest as Partial<Credentials>),
    queryIds: (rest["queryIds"] as Record<string, string>) ?? {},
    features: (rest["features"] as Record<string, string>) ?? {},
  };
}

async function captureHomeTab(
  cdpUrl: string,
  operation: "HomeTimeline" | "HomeLatestTimeline",
  clickFollowing: boolean,
  signal: AbortSignal,
  onStatus: ((message: string) => void) | undefined,
): Promise<Credentials> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  let captured: Credentials = { queryIds: {}, features: {} };
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no page context.");
    const page = await context.newPage();
    try {
      page.on("request", (request) => {
        try {
          const headers = Object.entries(request.headers()).map(([name, value]) => ({ name, value }));
          const entry = captureRequest(request.url(), "https://x.com", headers,
            request.method(), request.postData() ?? undefined);
          if (entry) captured = mergeCapture(captured, entry);
        } catch { /* Ignore requests that are not X GraphQL captures. */ }
      });
      onStatus?.("Observing " + operation + " from x.com/home…");
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
      const tabName = clickFollowing ? /following/iu : /for you/iu;
      await page.getByRole("tab", { name: tabName }).first().click({ timeout: 15_000 }).catch(() => {});
      const deadline = Date.now() + 20_000;
      while (!captured.queryIds[operation] && Date.now() < deadline) {
        if (signal.aborted) throw new Error("Interrupted while capturing " + operation + ".");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      await page.close().catch(() => {});
    }
    return captured;
  } finally {
    await browser.close();
  }
}

export async function connectX(options: ConnectXOptions = {}): Promise<XClient> {
  const resolved = resolveBackend({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
  });
  const signal = options.signal ?? new AbortController().signal;
  const session = await readBrowserSession(resolved.cdpUrl, resolved.backend);
  if (options.expectedAccountId && session.userId !== options.expectedAccountId) {
    throw new Error("The signed-in X account changed. Expected " + options.expectedAccountId
      + " but found " + session.userId + ". No data was saved.");
  }
  const feed: Feed = options.feed ?? "home-for-you";
  const operation = operationForFeed(feed);
  const credentials = await readCapturedCredentials(session, resolved.cdpUrl, resolved.backend, {
    required: [],
    onStatus: options.onStatus,
    signal,
  });
  if (!credentials.queryIds[operation]) {
    const fresh = await captureHomeTab(resolved.cdpUrl, operation, feed === "home-following", signal, options.onStatus);
    const merged: Credentials = {
      ...credentials,
      queryIds: { ...credentials.queryIds, ...fresh.queryIds },
      features: { ...credentials.features, ...fresh.features },
      fieldToggles: { ...credentials.fieldToggles, ...fresh.fieldToggles },
      methods: { ...credentials.methods, ...fresh.methods },
      authorization: fresh.authorization ?? credentials.authorization,
    };
    Object.assign(credentials, merged);
    writeJsonFile(credentialsCachePath(), { ...merged, cached_at: new Date().toISOString() });
  }
  const request = (target: Operation, variables: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> =>
    requestWithRetry(
      { credentials: async () => credentials, session: async () => cookieSession(session) },
      session.userId,
      target,
      variables,
      requestSignal,
      options.onStatus ?? (() => {}),
    );
  return {
    accountId: session.userId,
    feed,
    request,
    async homePage(continuation, requestSignal): Promise<HomePage> {
      const raw = await request(operation, homeVariables(continuation), requestSignal);
      return { result: parseHomeTimeline(raw, new Date().toISOString()), raw };
    },
  };
}

export function postsFromPage(page: HomePage): DiscoveredPost[] {
  return page.result.valid ? page.result.posts : [];
}

export { cachedCredentials };
