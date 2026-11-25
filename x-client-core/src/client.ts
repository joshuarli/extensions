import { chromium } from "playwright";
import { Schema } from "effect";
import { followAccount, type FollowResult } from "./follow.ts";
import { cookieSession, readBrowserSession, type XSession } from "../../lib/x-session.ts";
import { resolveBackend } from "../../x-archive-cli/src/backend.ts";
import type { Backend } from "../../lib/cli.ts";
import type { GraphqlRequestDeps } from "../../x-archive-core/src/collector.ts";
import { readCapturedCredentials, type RequiredCaptures } from "../../x-archive-cli/src/deps.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { delay, requestWithRetry } from "../../x-archive-core/src/collector.ts";
import { RequestFailure } from "../../x-archive-core/src/api.ts";
import {
  CredentialsSchema,
  captureRequest,
  mergeCapture,
  mergeCredentials,
  type Credentials,
  type Operation,
} from "../../x-archive-core/src/capture.ts";
import { parseHomeTimeline, type ParsedHomeTimeline } from "../../x-discovery-core/src/parser.ts";
import type { DiscoveredPost } from "../../x-discovery-core/src/post.ts";
import type { Feed } from "../../x-discovery-core/src/observation.ts";

export interface ConnectXDependencies {
  readSession(cdpUrl: string, backend: Backend): Promise<XSession>;
  readCredentials(
    session: XSession,
    cdpUrl: string,
    backend: Backend,
    options: {
      required: RequiredCaptures;
      screenName?: string | undefined;
      onStatus?: ((message: string) => void) | undefined;
      signal: AbortSignal;
    },
  ): Promise<Credentials>;
  captureHome(
    cdpUrl: string,
    operation: "HomeTimeline" | "HomeLatestTimeline",
    clickFollowing: boolean,
    signal: AbortSignal,
    onStatus: ((message: string) => void) | undefined,
  ): Promise<Credentials>;
  persist(credentials: Credentials): void;
  request(
    deps: GraphqlRequestDeps,
    userId: string,
    operation: Operation,
    variables: Record<string, unknown>,
    signal: AbortSignal,
    report: (message: string) => void,
  ): Promise<unknown>;
}

export interface ConnectXOptions {
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  expectedAccountId?: string | undefined;
  required?: RequiredCaptures | undefined;
  screenName?: string | undefined;
  feed?: Feed | undefined;
  signal?: AbortSignal | undefined;
  onStatus?: ((message: string) => void) | undefined;
  dependencies?: Partial<ConnectXDependencies> | undefined;
}

export interface HomePage {
  result: ParsedHomeTimeline;
  raw: unknown;
}

export interface XClient {
  accountId: string;
  request(operation: Operation, variables: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  homePage(continuation: string | null, signal: AbortSignal): Promise<HomePage>;
  follow(userId: string, signal: AbortSignal): Promise<FollowResult>;
  operations: readonly Operation[];
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
  try {
    return Schema.decodeUnknownSync(CredentialsSchema)(rest);
  } catch {
    return { queryIds: {}, features: {} };
  }
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
        await delay(500, signal);
      }
    } finally {
      await page.close().catch(() => {});
    }
    return captured;
  } finally {
    await browser.close();
  }
}

function operationFingerprint(credentials: Credentials, operation: Operation): string {
  return JSON.stringify({
    queryId: credentials.queryIds[operation] ?? null,
    method: credentials.methods?.[operation] ?? "GET",
    features: credentials.features[operation] ?? null,
    fieldToggles: credentials.fieldToggles?.[operation] ?? null,
  });
}

function persistCredentials(credentials: Credentials): void {
  writeJsonFile(credentialsCachePath(), { ...credentials, cached_at: new Date().toISOString() });
}

export async function connectX(options: ConnectXOptions = {}): Promise<XClient> {
  const resolved = resolveBackend({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
  });
  const signal = options.signal ?? new AbortController().signal;
  const deps: ConnectXDependencies = {
    readSession: (cdpUrl, backend) => readBrowserSession(cdpUrl, backend),
    readCredentials: (session, cdpUrl, backend, captureOptions) =>
      readCapturedCredentials(session, cdpUrl, backend, captureOptions),
    captureHome: (cdpUrl, target, clickFollowing, requestSignal, onStatus) =>
      captureHomeTab(cdpUrl, target, clickFollowing, requestSignal, onStatus),
    persist: persistCredentials,
    request: requestWithRetry,
    ...(options.dependencies ?? {}),
  };
  const session = await deps.readSession(resolved.cdpUrl, resolved.backend);
  if (options.expectedAccountId && session.userId !== options.expectedAccountId) {
    throw new Error("The signed-in X account changed. Expected " + options.expectedAccountId
      + " but found " + session.userId + ". No data was saved.");
  }
  const feed: Feed = options.feed ?? "home-for-you";
  const operation = operationForFeed(feed);
  const required = options.required ?? [[operation]];
  const credentials = await deps.readCredentials(session, resolved.cdpUrl, resolved.backend, {
    required,
    screenName: options.screenName,
    onStatus: options.onStatus,
    signal,
  });
  const absorb = (fresh: Credentials): void => {
    const before = operationFingerprint(credentials, operation);
    const merged = mergeCredentials(credentials, fresh);
    Object.assign(credentials, merged);
    if (operationFingerprint(credentials, operation) !== before) deps.persist(credentials);
  };
  if (!credentials.queryIds[operation]) {
    absorb(await deps.captureHome(resolved.cdpUrl, operation, feed === "home-following", signal, options.onStatus));
  }
  const rawRequest = (target: Operation, variables: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> =>
    deps.request(
      { credentials: async () => credentials, session: async () => cookieSession(session) },
      session.userId,
      target,
      variables,
      requestSignal,
      options.onStatus ?? (() => {}),
    );
  let refreshed = false;
  const request = async (target: Operation, variables: Record<string, unknown>, requestSignal: AbortSignal): Promise<unknown> => {
    try {
      return await rawRequest(target, variables, requestSignal);
    } catch (error) {
      if (!(error instanceof RequestFailure) || error.kind !== "query" || target !== operation || refreshed) throw error;
      refreshed = true;
      options.onStatus?.("X rejected the captured " + target + " configuration; re-observing it once…");
      const before = operationFingerprint(credentials, target);
      absorb(await deps.captureHome(resolved.cdpUrl, operation, feed === "home-following", requestSignal, options.onStatus));
      if (operationFingerprint(credentials, target) === before) {
        throw new RequestFailure("query", "X rejected " + target + " and re-observation returned the same configuration. A manual refresh is needed.");
      }
      return await rawRequest(target, variables, requestSignal);
    }
  };
  return {
    accountId: session.userId,
    feed,
    request,
    operations: Object.keys(credentials.queryIds) as Operation[],
    follow: (userId, requestSignal) => followAccount(session, userId, requestSignal, credentials.authorization),
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
