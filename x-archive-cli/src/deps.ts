import { chromium, type BrowserContext } from "playwright";
import { join } from "node:path";
import {
  CredentialsSchema,
  PROFILE_OPERATIONS,
  credentialKey,
  parseUserId,
  parseProfileScreenName,
  type Credentials,
  type Operation,
  type ProfileTarget,
} from "../../x-archive-core/src/capture.ts";
import { Schema } from "effect";
import type { ArchiveDeps } from "../../x-archive-core/src/collector.ts";
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

export interface XSession {
  userId: string;
  cookies: { name: string; value: string }[];
}

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

const BOOKMARK_CAPTURE_OPERATIONS = new Set<Operation>(["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"]);
const LIKE_CAPTURE_OPERATIONS = new Set<Operation>(["Likes"]);
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

export function capturePages(required: RequiredCaptures, screenName: string | undefined): string[] {
  const operations = required.flat();
  const pages: string[] = [];
  if (operations.some((operation) => operation === "HomeTimeline")) pages.push("https://x.com/home");
  if (operations.some((operation) => BOOKMARK_CAPTURE_OPERATIONS.has(operation))) pages.push("https://x.com/i/history");
  if (operations.some((operation) => LIKE_CAPTURE_OPERATIONS.has(operation))) pages.push("https://x.com/i/history/likes");
  if (operations.some((operation) => operation === "UserByScreenName" || PROFILE_CAPTURE_OPERATIONS.has(operation))) {
    const profile = screenName ? parseProfileScreenName("https://x.com/" + screenName) : null;
    if (!profile) throw new Error("Cannot capture profile credentials without a valid @handle.");
    pages.push("https://x.com/" + profile);
  }
  return pages;
}

function mergeCredentials(base: Credentials, next: Credentials): Credentials {
  return {
    authorization: next.authorization ?? base.authorization,
    clientUuid: next.clientUuid ?? base.clientUuid,
    transactionId: next.transactionId ?? base.transactionId,
    queryIds: { ...base.queryIds, ...next.queryIds },
    features: { ...base.features, ...next.features },
    fieldToggles: { ...base.fieldToggles, ...next.fieldToggles },
  };
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

export async function readBrowserSession(cdpUrl: string, backend: Backend = HELIUM_BACKEND): Promise<XSession> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    if (backend.kind === "bctl") {
      throw new Error(
        `The bctl session "${backend.session ?? "xarchive"}" is not reachable at ${cdpUrl}. `
        + "Check `bctl status`; sign in once with `bctl profile login " + (backend.session ?? "xarchive") + "`.",
      );
    }
    throw new Error(
      "Helium is not reachable on " + cdpUrl + ". Start Helium with `~/usr/bin/helium` (remote debugging enabled) and retry.",
    );
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no context to read cookies from.");
    const cookies = (await context.cookies("https://x.com/")).map(({ name, value }) => ({ name, value }));
    const twid = cookies.find((cookie) => cookie.name === "twid");
    const userId = parseUserId(twid?.value);
    if (!userId) {
      throw new Error(backend.kind === "bctl"
        ? `Not signed in to X in the bctl session "${backend.session ?? "xarchive"}". Run \`bctl profile login ${backend.session ?? "xarchive"}\` once, then retry.`
        : "Not signed in to X in this Helium (no twid cookie). Sign in to x.com first.");
    }
    return { userId, cookies };
  } finally {
    await browser.close();
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
    let credentials: Credentials | null = await workerCredentials(context, extensionId, session.userId);
    if (credentials && cached) credentials = mergeCredentials(cached, credentials);
    if (!credentials) credentials = cached;
    const pages = capturePages(required, capture.screenName);
    if ((!credentials || !hasRequiredCaptures(credentials, required)) && pages.length > 0) {
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
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
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
    throw new Error(
      "X credentials are incomplete (" + missing.join(", ") + "). "
      + (pages.length ? "Visit " + pages.join(" and ") + " in Helium once, then retry." : "Open x.com in Helium once, then retry."),
    );
  } finally {
    await browser.close();
  }
}

function cookieHeader(session: XSession): string {
  return session.cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

export function cookieSession(session: XSession): { userId: string | null; csrfToken: string | null; cookieHeader: string } {
  const ct0 = session.cookies.find((cookie) => cookie.name === "ct0");
  return { userId: session.userId, csrfToken: ct0?.value ?? null, cookieHeader: cookieHeader(session) };
}

export function cookieHeaders(session: XSession): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    Referer: "https://x.com/",
    Cookie: cookieHeader(session),
  };
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


