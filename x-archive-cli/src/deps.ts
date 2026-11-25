import { chromium, type BrowserContext } from "playwright";
import { join } from "node:path";
import {
  BOOKMARK_OPERATIONS,
  LIKES_OPERATIONS,
  CredentialsSchema,
  PROFILE_OPERATIONS,
  captureErrorKey,
  SOCIAL_OPERATIONS,
  captureRequest,
  credentialKey,
  mergeCapture,
  mergeCredentials,
  parseProfileScreenName,
  type Credentials,
  type Operation,
  type ProfileTarget,
} from "../../x-archive-core/src/capture.ts";
import { Schema } from "effect";
import { delay, type ArchiveDeps } from "../../x-archive-core/src/collector.ts";
import { HELIUM_BACKEND, type Backend } from "./backend.ts";
import { ensureSuiteExtensionOnBrowser, suiteWorker } from "./extension.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile, stateDir } from "./state.ts";

export type RequiredCaptures = readonly (readonly Operation[])[];

export interface CaptureOptions {
  readonly required?: RequiredCaptures;
  readonly screenName?: string | undefined;
  readonly onStatus?: ((text: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}
const CACHE_MAX_AGE_DAYS = 30;

export { readBrowserSession, cookieSession, cookieHeaders, type XSession } from "../../lib/x-session.ts";
import { cookieSession, type XSession } from "../../lib/x-session.ts";

interface CachedCredentials {
  queryIds: Record<string, string>;
  features: Record<string, string>;
  fieldToggles?: Record<string, string> | undefined;
  authorization?: string | undefined;
  clientUuid?: string | undefined;
  transactionId?: string | undefined;
  cached_at: string;
}

function cachedCredentials(): CachedCredentials | null {
  const value = readJsonFile(credentialsCachePath());
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["cached_at"] !== "string") return null;
  const ageMs = Date.now() - Date.parse(record["cached_at"]);
  if (!Number.isFinite(ageMs) || ageMs > CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;
  try {
    const { cached_at: _cached, ...rest } = record;
    return { cached_at: record["cached_at"], ...Schema.decodeUnknownSync(CredentialsSchema)(rest) } as CachedCredentials;
  } catch {
    return null;
  }
}

function cacheCredentials(credentials: Credentials): void {
  try {
    writeJsonFile(credentialsCachePath(), { ...credentials, cached_at: new Date().toISOString() });
  } catch { /* The cache is an optimization; never fail the run over it. */ }
}

const BOOKMARK_CAPTURE_OPERATIONS = new Set<Operation>(BOOKMARK_OPERATIONS);
const LIKE_CAPTURE_OPERATIONS = new Set<Operation>(LIKES_OPERATIONS);
const PROFILE_CAPTURE_OPERATIONS = new Set<Operation>(PROFILE_OPERATIONS);

export function missingCaptures(credentials: Credentials, required: RequiredCaptures): string[] {
  return required
    .filter((group) => !group.some((operation) => !!credentials.queryIds[operation]))
    .map((group) => group.join(" / "));
}

export function hasRequiredCaptures(credentials: Credentials, required: RequiredCaptures): boolean {
  return !!credentials.authorization
    && Object.keys(credentials.queryIds).length > 0
    && missingCaptures(credentials, required).length === 0;
}

export interface CredentialCapturePlan {
  pages: string[];
  credentials: Credentials | null;
  needsCapture: boolean;
}

export function credentialCapturePlan(
  required: RequiredCaptures,
  screenName: string | undefined,
  cached: Credentials | null,
  worker: Credentials | null,
): CredentialCapturePlan {
  const pages = capturePages(required, screenName);
  const credentials = worker && cached ? mergeCredentials(cached, worker) : worker ?? cached;
  return {
    pages,
    credentials,
    needsCapture: pages.length > 0 && (credentials === null || !hasRequiredCaptures(credentials, required)),
  };
}

export async function captureOperationsFromBrowser(
  cdpUrl: string,
  pages: readonly (readonly [Operation, string])[],
  signal: AbortSignal,
  onStatus: (text: string) => void = () => {},
): Promise<Credentials> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  let credentials: Credentials = { queryIds: {}, features: {} };
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no page context.");
    for (const [operation, url] of pages) {
      if (signal.aborted) throw new Error("Interrupted while capturing X credentials.");
      if (credentials.queryIds[operation]) continue;
      onStatus("Capturing " + operation + " from " + url + "…");
      const page = await context.newPage();
      try {
        page.on("request", (request) => {
          try {
            const headers = Object.entries(request.headers()).map(([name, value]) => ({ name, value }));
            const capture = captureRequest(request.url(), "https://x.com", headers,
              request.method(), request.postData() ?? undefined);
            if (capture) credentials = mergeCapture(credentials, capture);
          } catch { /* Ignore requests that are not X GraphQL captures. */ }
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
        const deadline = Date.now() + 20_000;
        while (!credentials.queryIds[operation] && Date.now() < deadline) {
          if (signal.aborted) throw new Error("Interrupted while capturing X credentials.");
          await delay(500, signal);
        }
      } finally {
        await page.close().catch(() => {});
      }
    }
    return credentials;
  } finally {
    await browser.close();
  }
}

export function capturePages(required: RequiredCaptures, screenName: string | undefined): string[] {
  const operations = required.flat();
  const pages: string[] = [];
  if (operations.some((operation) => operation === "HomeTimeline")) pages.push("https://x.com/home");
  if (operations.some((operation) => (SOCIAL_OPERATIONS as readonly Operation[]).includes(operation))) {
    if (!screenName) throw new Error("Cannot capture following and followers without a valid @handle.");
    pages.push("https://x.com/" + screenName + "/following", "https://x.com/" + screenName + "/followers");
  }
  if (operations.some((operation) => BOOKMARK_CAPTURE_OPERATIONS.has(operation))) pages.push("https://x.com/i/history");
  if (operations.some((operation) => LIKE_CAPTURE_OPERATIONS.has(operation))) pages.push("https://x.com/i/history/likes");
  if (operations.some((operation) => operation === "UserByScreenName" || PROFILE_CAPTURE_OPERATIONS.has(operation))) {
    const profile = screenName ? parseProfileScreenName("https://x.com/" + screenName) : null;
    if (!profile) throw new Error("Cannot capture profile credentials without a valid @handle.");
    pages.push("https://x.com/" + profile);
  }
  return pages;
}

async function workerCaptureError(
  context: BrowserContext,
  extensionId: string,
  userId: string,
): Promise<string | null> {
  let worker;
  try {
    worker = await suiteWorker(context, extensionId, 2_000);
  } catch {
    return null;
  }
  try {
    const raw = await worker.evaluate(async (key: string): Promise<unknown> => {
      const all = await chrome.storage.local.get(key);
      return all[key] ?? null;
    }, captureErrorKey(userId));
    const stored = raw as { message?: unknown } | null;
    return typeof stored?.["message"] === "string" ? stored["message"] : null;
  } catch {
    return null;
  }
}

async function workerCredentials(
  context: BrowserContext,
  extensionId: string,
  userId: string,
): Promise<Credentials | null> {
  let worker;
  try {
    worker = await suiteWorker(context, extensionId, 2_000);
  } catch {
    return null;
  }
  try {
    const raw = await worker.evaluate(async (key: string): Promise<unknown> => {
      const all = await chrome.storage.local.get(key);
      return all[key] ?? null;
    }, credentialKey(userId));
    return raw === null ? null : Schema.decodeUnknownSync(CredentialsSchema)(raw);
  } catch {
    return null;
  }
}

export async function readCapturedCredentials(
  session: XSession,
  cdpUrl: string,
  backend: Backend = HELIUM_BACKEND,
  capture: CaptureOptions = {},
): Promise<Credentials> {
  const required = capture.required ?? [];
  if (capture.signal?.aborted) throw new Error("Interrupted while reading X credentials.");
  const cached = cachedCredentials();
  if (backend.kind === "bctl") {
    if (cached && hasRequiredCaptures(cached, required)) return cached;
    throw new Error(
      `The bctl session "${backend.session ?? "xarchive"}" cannot capture X credentials. `
      + "Run `X_ARCHIVE_BACKEND=helium x download self` from a signed-in Helium once to seed the cache, then retry.",
    );
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    if (cached && hasRequiredCaptures(cached, required)) return cached;
    throw new Error(
      "Helium is not reachable on " + cdpUrl
      + (cached ? " and its cached credentials are missing " + missingCaptures(cached, required).join(", ") + "." : " and no cached credentials exist yet.")
      + " Start Helium with `~/usr/bin/helium` and retry.",
    );
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no context to read extension storage from.");
    capture.onStatus?.("Loading the X Archive extension into Helium…");
    const extensionId = await ensureSuiteExtensionOnBrowser(browser);
    const worker = await workerCredentials(context, extensionId, session.userId);
    const plan = credentialCapturePlan(required, capture.screenName, cached, worker);
    let credentials: Credentials | null = plan.credentials;
    const pages = plan.pages;
    if (plan.needsCapture) {
      capture.onStatus?.("Capturing X GraphQL credentials from " + pages.length + " page(s)…");
      for (const url of pages) {
        if (capture.signal?.aborted) throw new Error("Interrupted while capturing X credentials.");
        if (credentials && hasRequiredCaptures(credentials, required)) break;
        const page = await context.newPage();
        try {
          try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
          } catch (error) {
            capture.onStatus?.("Could not open " + url + ": " + (error instanceof Error ? error.message : String(error)));
          }
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            if (capture.signal?.aborted) throw new Error("Interrupted while capturing X credentials.");
            const latest = await workerCredentials(context, extensionId, session.userId);
            if (latest) {
              credentials = credentials ? mergeCredentials(credentials, latest) : latest;
              if (hasRequiredCaptures(credentials, required)) break;
            }
            await delay(500, capture.signal ?? new AbortController().signal);
          }
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
    if (credentials && hasRequiredCaptures(credentials, required)) {
      cacheCredentials(credentials);
      return credentials;
    }
    const missing = credentials ? missingCaptures(credentials, required) : ["all operations"];
    const captureError = await workerCaptureError(context, extensionId, session.userId);
    throw new Error(
      "X credentials are incomplete (" + missing.join(", ") + "). "
      + (pages.length ? "Visit " + pages.join(" and ") + " in Helium once, then retry." : "Open x.com in Helium once, then retry.")
      + (captureError ? " Last capture failed: " + captureError : ""),
    );
  } finally {
    await browser.close();
  }
}

export function buildDeps(session: XSession, credentials: Credentials): ArchiveDeps {
  const bindingPath = join(stateDir(session.userId), "profile-targets.json");
  const readBinding = (): Record<string, ProfileTarget> => {
    const value = readJsonFile(bindingPath);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, ProfileTarget>
      : {};
  };
  return {
    credentials: async () => credentials,
    currentUserId: async () => session.userId,
    readProfileTarget: async (userId: string) => {
      if (userId !== session.userId) return null;
      const binding = readBinding()["current"];
      return binding ?? null;
    },
    writeProfileTarget: async (userId: string, target: ProfileTarget) => {
      if (userId !== session.userId) return;
      writeJsonFile(bindingPath, { current: target });
    },
    session: async () => cookieSession(session),
  };
}


