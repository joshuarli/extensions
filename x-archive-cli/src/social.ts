import { chromium } from "playwright";
import { join } from "node:path";
import { Schema } from "effect";
import type { Backend } from "../../lib/cli.ts";
import {
  CredentialsSchema,
  SOCIAL_OPERATIONS,
  type Credentials,
  type SocialOperation,
} from "../../x-archive-core/src/capture.ts";
import { RequestFailure } from "../../x-archive-core/src/api.ts";
import { delay, requestWithRetry } from "../../x-archive-core/src/collector.ts";
import { parseUserList } from "../../x-archive-core/src/parser.ts";
import {
  captureOperationsFromBrowser,
  cookieSession,
  type XSession,
} from "./deps.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile } from "./state.ts";

export interface SocialOptions {
  cdpUrl: string;
  outRoot: string;
  signal: AbortSignal;
  backend: Backend;
  onStatus: (text: string) => void;
}

export interface SocialSummary {
  folder: string;
  following: number;
  followers: number;
  reason: string;
}

const MAX_PAGES = 100;

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

function mergeCredentials(base: Credentials, next: Credentials): Credentials {
  return {
    ...base,
    ...(next.authorization ? { authorization: next.authorization } : {}),
    ...(next.clientUuid ? { clientUuid: next.clientUuid } : {}),
    ...(next.transactionId ? { transactionId: next.transactionId } : {}),
    methods: { ...base.methods, ...next.methods },
    queryIds: { ...base.queryIds, ...next.queryIds },
    features: { ...base.features, ...next.features },
    fieldToggles: { ...base.fieldToggles, ...next.fieldToggles },
  };
}

async function ownScreenName(cdpUrl: string, userId: string, signal: AbortSignal): Promise<string> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no page context.");
    const page = await context.newPage();
    try {
      await page.goto("https://x.com/i/user/" + userId, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {});
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (signal.aborted) throw new Error("Interrupted while resolving your X handle.");
        const match = /^https:\/\/x\.com\/([A-Za-z0-9_]+)\/?$/u.exec(page.url());
        if (match?.[1]) return match[1];
        await delay(500, signal);
      }
      throw new Error("Could not resolve your X handle from https://x.com/i/user/" + userId
        + ". Open your profile in Helium once, then retry.");
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close();
  }
}

async function ensureCredentials(
  options: SocialOptions,
  screenName: string,
): Promise<Credentials> {
  let credentials = mergeCredentials(cachedCredentials(), { queryIds: {}, features: {} });
  const missing = SOCIAL_OPERATIONS.filter((operation) => !credentials.queryIds[operation]);
  if (missing.length === 0) return credentials;
  const pages = missing.map((operation: SocialOperation) => [
    operation,
    "https://x.com/" + screenName + "/" + operation.toLowerCase(),
  ] as const);
  const captured = await captureOperationsFromBrowser(options.cdpUrl, pages, options.signal, options.onStatus);
  credentials = mergeCredentials(credentials, captured);
  writeJsonFile(credentialsCachePath(), { ...credentials, cached_at: new Date().toISOString() });
  const stillMissing = SOCIAL_OPERATIONS.filter((operation) => !credentials.queryIds[operation]);
  if (stillMissing.length > 0) {
    throw new Error("X did not emit " + stillMissing.join(" and ") + ". Open each tab in Helium once, then retry.");
  }
  return credentials;
}

async function collectList(
  session: XSession,
  credentials: Credentials,
  operation: SocialOperation,
  options: SocialOptions,
  refresh: () => Promise<Credentials>,
): Promise<{ users: Awaited<ReturnType<typeof parseUserList>>["users"]; reason: string }> {
  const users: Awaited<ReturnType<typeof parseUserList>>["users"] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let reason = "complete";
  let refreshed = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (options.signal.aborted) {
      reason = "stopped";
      break;
    }
    let data: unknown;
    try {
      data = await requestWithRetry(
        { credentials: async () => credentials, session: async () => cookieSession(session) },
        session.userId,
        operation,
        {
          userId: session.userId,
          count: 20,
          includePromotedContent: false,
          withGrokTranslatedBio: true,
          ...(cursor === null ? {} : { cursor }),
        },
        options.signal,
        options.onStatus,
      );
    } catch (error) {
      if (error instanceof RequestFailure && error.kind === "query" && !refreshed) {
        refreshed = true;
        options.onStatus(operation + " query was rejected; re-observing it from the browser…");
        try {
          credentials = await refresh();
          continue;
        } catch (refreshError) {
          reason = "refresh_failed";
          options.onStatus("Refresh failed: " + (refreshError instanceof Error ? refreshError.message : String(refreshError)));
          break;
        }
      }
      reason = error instanceof RequestFailure && error.kind === "stopped" ? "stopped" : "request_failed";
      options.onStatus(operation + " stopped after " + users.length + " users: "
        + (error instanceof Error ? error.message : String(error)));
      break;
    }
    const parsed = parseUserList(data, new Date().toISOString());
    if (!parsed.valid) {
      reason = "unexpected_shape";
      break;
    }
    for (const user of parsed.users) {
      if (seen.has(user.user_id)) continue;
      seen.add(user.user_id);
      users.push(user);
    }
    if (parsed.nextCursor === null) break;
    if (parsed.nextCursor === cursor) {
      reason = "cursor_stalled";
      break;
    }
    cursor = parsed.nextCursor;
    await delay(2000, options.signal);
  }
  return { users, reason };
}

export async function downloadSocialLists(
  session: XSession,
  options: SocialOptions,
): Promise<SocialSummary> {
  const screenName = await ownScreenName(options.cdpUrl, session.userId, options.signal);
  let credentials = await ensureCredentials(options, screenName);
  const refresh = async (operation: SocialOperation): Promise<Credentials> => {
    const captured = await captureOperationsFromBrowser(options.cdpUrl,
      [[operation, "https://x.com/" + screenName + "/" + operation.toLowerCase()]],
      options.signal, options.onStatus);
    credentials = mergeCredentials(credentials, captured);
    writeJsonFile(credentialsCachePath(), { ...credentials, cached_at: new Date().toISOString() });
    return credentials;
  };
  const folder = "social-" + new Date().toISOString().slice(0, 10);
  const outDir = join(options.outRoot, folder);
  const reasons: string[] = [];
  const counts = { following: 0, followers: 0 };
  for (const operation of SOCIAL_OPERATIONS) {
    options.onStatus("Collecting " + operation + "…");
    const result = await collectList(session, credentials, operation, options, () => refresh(operation));
    counts[operation.toLowerCase() as "following" | "followers"] = result.users.length;
    reasons.push(operation + ":" + result.reason);
    writeJsonFile(join(outDir, operation.toLowerCase() + ".json"), {
      account_id: session.userId,
      captured_at: new Date().toISOString(),
      count: result.users.length,
      users: result.users,
    }, 0o644);
  }
  return { folder, ...counts, reason: reasons.join(", ") };
}
