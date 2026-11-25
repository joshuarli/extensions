import { join } from "node:path";
import { connectX } from "../../x-client-core/src/client.ts";
import { PROFILE_OPERATIONS } from "../../x-archive-core/src/capture.ts";
import { extractLookupUserId, delay } from "../../x-archive-core/src/collector.ts";
import { parseProfileTimeline, type Bookmark } from "../../x-archive-core/src/parser.ts";
import { DiscoveryStore, newRun, type DiscoveredPost } from "../../x-discovery-core/src/index.ts";

export interface EnrichOptions {
  outDir: string;
  handles: readonly string[];
  maxPages: number;
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  signal: AbortSignal;
  onStatus?: ((message: string) => void) | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function toPost(bookmark: Bookmark, authorId: string, handle: string, observedAt: string): DiscoveredPost {
  const author = asRecord(bookmark.author);
  const entities = asRecord(bookmark.entities);
  const urls = Array.isArray(entities?.["urls"]) ? entities["urls"] : [];
  return {
    tweet_id: bookmark.tweet_id,
    author_id: typeof author?.["user_id"] === "string" ? author["user_id"] : authorId,
    author_handle: typeof author?.["screen_name"] === "string" ? author["screen_name"] : handle,
    author_name: typeof author?.["name"] === "string" ? author["name"] : null,
    created_at: bookmark.created_at ?? "",
    full_text: bookmark.full_text ?? "",
    lang: bookmark.lang ?? "",
    urls: urls.flatMap((entry) => {
      const record = asRecord(entry);
      const url = typeof record?.["expanded_url"] === "string" ? record["expanded_url"] : null;
      if (!url) return [];
      return [{ url, display_url: typeof record?.["display_url"] === "string" ? record["display_url"] : url }];
    }),
    favorite_count: 0,
    retweet_count: 0,
    relationship: { kind: "original", source_tweet_id: null, source_handle: null },
    observed_at: observedAt,
  };
}

export async function enrichCandidates(options: EnrichOptions): Promise<{
  handles: number;
  posts: number;
  failures: string[];
}> {
  if (options.handles.length === 0) throw new Error("enrich needs --handles=a,b.");
  const client = await connectX({
    cdpUrl: options.cdpUrl,
    backend: options.backend,
    session: options.session,
    required: [["UserByScreenName"], [...PROFILE_OPERATIONS]],
    signal: options.signal,
    onStatus: options.onStatus,
  });
  const store = new DiscoveryStore(join(options.outDir, "discovery.db"));
  const failures: string[] = [];
  let posts = 0;
  try {
    for (const handle of options.handles) {
      if (options.signal.aborted) break;
      options.onStatus?.("Sampling @" + handle + "…");
      try {
        const lookup = await client.request("UserByScreenName", { screen_name: handle.replace(/^@/u, "") }, options.signal);
        const authorId = extractLookupUserId(lookup);
        if (!authorId) throw new Error("profile id not found");
        const run = newRun(client.accountId, "profile", options.maxPages);
        store.beginRun(run);
        let cursor: string | null = null;
        let page = 0;
        let runReason = "budget_reached";
        try {
        while (page < options.maxPages) {
          if (options.signal.aborted) break;
          const data = await client.request("UserTweets", {
            userId: authorId,
            count: 20,
            includePromotedContent: false,
            ...(cursor === null ? {} : { cursor }),
          }, options.signal);
          const observedAt = new Date().toISOString();
          const parsed = parseProfileTimeline(data, observedAt, authorId);
          if (!parsed.valid) break;
          const sampled = parsed.posts.map((bookmark) => toPost(bookmark, authorId, handle, observedAt));
          store.commitPage({
            runId: run.runId,
            accountId: client.accountId,
            feed: "profile",
            page: ++page,
            data,
            posts: sampled,
            cursor: parsed.nextCursor ?? null,
            accounting: {
              total: parsed.posts.length,
              posts: sampled.length,
              cursors: parsed.nextCursor ? 1 : 0,
              nonPost: 0,
              unavailable: 0,
              unsupported: 0,
              postBearingUnsupported: 0,
              modulePosts: 0,
            },
          });
          posts += sampled.length;
          if (parsed.nextCursor === null || parsed.nextCursor === cursor) break;
          cursor = parsed.nextCursor;
          await delay(1500, options.signal);
        }
        } catch (error) {
          runReason = "failed";
          throw error;
        } finally {
          store.finishRun(run.runId, options.signal.aborted ? "stopped" : runReason);
        }
      } catch (error) {
        failures.push(handle + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    return { handles: options.handles.length - failures.length, posts, failures };
  } finally {
    store.close();
  }
}
