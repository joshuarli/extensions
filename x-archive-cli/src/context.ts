import { extractConversationTweets, parseContextTweet } from "../../x-archive-core/src/conversation.ts";
import type { Bookmark } from "../../x-archive-core/src/parser.ts";
import type { SqliteProfileStore } from "./profile-db.ts";

const USER_AGENT = (
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
  + " (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
);
const PAGE_DELAY_MS = 900;
const MAX_ATTEMPTS = 6;
const MAX_CONSECUTIVE_FAILURES = 10;
const FETCH_TIMEOUT_MS = 45_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Context backfill stopped."));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Context backfill stopped."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchConversation(focalId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch("https://x.com/i/web/status/" + focalId, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    redirect: "follow",
  });
  if (response.status !== 200) throw new Error("HTTP " + response.status);
  return response.text();
}

export interface ContextSyncOptions {
  store: SqliteProfileStore;
  targetUserId: string;
  signal: AbortSignal;
  report: (message: string) => void;
  fetchHtml?: (focalId: string, signal: AbortSignal) => Promise<string>;
  pageDelayMs?: number;
  backoffMs?: (consecutiveFailures: number) => number;
}

export interface ContextSyncResult {
  fetched: number;
  stored: number;
  failed: number;
  unreachable: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function idOf(value: unknown): string | null {
  const rec = record(value);
  if (!rec) return null;
  const raw = rec["tweet_id"];
  return typeof raw === "string" && /^\d+$/u.test(raw) ? raw : null;
}

function parentOf(value: unknown): string | null {
  const rec = record(value);
  if (!rec) return null;
  const raw = rec["in_reply_to_tweet_id"];
  return typeof raw === "string" && /^\d+$/u.test(raw) ? raw : null;
}

function conversationIdOf(value: unknown): string | null {
  const rec = record(value);
  if (!rec) return null;
  const raw = rec["conversation_id"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export async function syncContextThreads(options: ContextSyncOptions): Promise<ContextSyncResult> {
  const { store, targetUserId, signal, report } = options;
  const fetchHtml = options.fetchHtml ?? fetchConversation;
  const pageDelayMs = options.pageDelayMs ?? PAGE_DELAY_MS;

  const own = (await store.allRecords() as Array<Record<string, unknown>>);
  const known = new Set<string>(own.map((entry) => String(entry["tweet_id"])));
  for (const id of await store.allContextIds(targetUserId)) known.add(id);
  const conversationOf = new Map<string, string>();
  for (const entry of own) {
    const cid = conversationIdOf(entry);
    const id = idOf(entry);
    if (cid && id) conversationOf.set(id, cid);
  }

  const work: string[] = [];
  for (const entry of own) {
    const id = idOf(entry);
    const parent = parentOf(entry);
    if (id && parent && !known.has(parent)) work.push(id);
  }
  const context = await store.allContextRecords() as Array<Record<string, unknown>>;
  for (const entry of context) {
    const id = idOf(entry);
    const parent = parentOf(entry);
    const cid = conversationIdOf(entry);
    if (id && cid) conversationOf.set(id, cid);
    if (id && parent && !known.has(parent)) work.push(id);
  }
  work.sort((a, b) => a.localeCompare(b));

  const attempts = new Map<string, number>();
  const result: ContextSyncResult = { fetched: 0, stored: 0, failed: 0, unreachable: 0 };
  let consecutiveFailures = 0;

  while (work.length > 0) {
    if (signal.aborted) {
      report("Context backfill stopped; re-running resumes.");
      break;
    }
    const focalId = work.pop()!;
    if (await store.contextPageStatus(focalId) === "ok") continue;
    if ((await store.contextPageAttempts(focalId) ?? 0) >= MAX_ATTEMPTS) {
      result.unreachable += 1;
      continue;
    }
    const made = (attempts.get(focalId) ?? 0) + 1;
    attempts.set(focalId, made);
    if (made > MAX_ATTEMPTS) {
      result.unreachable += 1;
      continue;
    }
    const conversationId = conversationOf.get(focalId) ?? focalId;

    if (result.fetched > 0) await delay(pageDelayMs + Math.random() * 250, signal);

    let tweetsById: Map<string, Record<string, unknown>>;
    try {
      const html = await fetchHtml(focalId, signal);
      const page = extractConversationTweets(html);
      tweetsById = new Map(page.tweets.map((tweet) => [String(tweet["rest_id"]), tweet]));
      consecutiveFailures = 0;
    } catch (error) {
      if (signal.aborted) {
        report("Context backfill stopped; re-running resumes.");
        break;
      }
      consecutiveFailures += 1;
      result.failed += 1;
      await store.markContextPage(focalId, "failed");
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        report("Context backfill paused after repeated X failures; re-running resumes where it left off.");
        break;
      }
      report("Context fetch failed for " + focalId + ": " + (error instanceof Error ? error.message : String(error)));
      const backoffMs = options.backoffMs ?? ((consecutive: number) => Math.min(30_000, 2_000 * 2 ** consecutive));
      await delay(backoffMs(consecutiveFailures), signal);
      continue;
    }

    result.fetched += 1;
    for (const restId of tweetsById.keys()) {
      if (!conversationOf.has(restId)) conversationOf.set(restId, conversationId);
    }

    const focalRecord = tweetsById.get(focalId) ?? null;
    let cur = focalRecord ? stringInReplyTo(focalRecord) : null;
    if (!focalRecord) {
      report("Context: page for " + focalId + " did not include the requested post; treating it as a gap.");
    }
    while (cur && !known.has(cur)) {
      const tweet = tweetsById.get(cur);
      if (!tweet) break;
      const parsed = parseContextTweet(tweet, conversationId, new Date().toISOString());
      if (!parsed) break;
      await store.saveContextPage([parsed as Bookmark], targetUserId);
      known.add(cur);
      result.stored += 1;
      const parent = parsed.in_reply_to_tweet_id;
      cur = typeof parent === "string" && parent.length > 0 ? parent : null;
    }
    if (cur && !known.has(cur)) {
      const pushed = work.includes(cur);
      if (!pushed) work.push(cur);
    }

    await store.markContextPage(focalId, "ok");

    if (result.fetched % 25 === 0) {
      report("Context: " + result.fetched + " pages fetched, " + result.stored + " posts stored, " + result.failed + " pages failed, " + work.length + " still queued.");
    }
  }

  return result;
}

function stringInReplyTo(tweet: Record<string, unknown>): string | null {
  const replyTo = tweet["reply_to_results"];
  if (replyTo === null || typeof replyTo !== "object" || Array.isArray(replyTo)) return null;
  const restId = (replyTo as Record<string, unknown>)["rest_id"];
  return typeof restId === "string" && /^\d+$/u.test(restId) ? restId : null;
}
