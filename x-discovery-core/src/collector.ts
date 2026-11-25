import { delay } from "../../x-archive-core/src/collector.ts";
import { parseHomeTimeline, type HomeEntryAccounting } from "./parser.ts";
import type { DiscoveredPost } from "./post.ts";

export interface PageCommit {
  page: number;
  data: unknown;
  posts: DiscoveredPost[];
  cursor: string | null;
  accounting: HomeEntryAccounting;
}

export interface PageFailure {
  page: number;
  data: unknown;
  detail: string;
  accounting: HomeEntryAccounting;
}

export interface HomeTimelineDeps {
  request(variables: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  savePosts(posts: DiscoveredPost[]): Promise<void>;
  readCursor(): Promise<string | null>;
  writeCursor(cursor: string | null): Promise<void>;
  commitPage?(commit: PageCommit): Promise<void>;
  commitFailure?(failure: PageFailure): Promise<void>;
  onPageStart?(): void | Promise<void>;
  signal: AbortSignal;
  report(message: string): void;
  maxPages: number;
  pageDelayMs?: number;
}

export type CollectionReason =
  | "timeline_complete"
  | "max_pages"
  | "cursor_stalled"
  | "unexpected_shape"
  | "stopped";

export interface CollectionResult {
  pages: number;
  posts: number;
  cursor: string | null;
  completed: boolean;
  reason: CollectionReason;
}

function homeVariables(cursor: string | null): Record<string, unknown> {
  return {
    count: 20,
    includePromotedContent: true,
    requestContext: "launch",
    withCommunity: true,
    ...(cursor === null ? {} : { cursor }),
  };
}

export async function collectHomeTimeline(deps: HomeTimelineDeps): Promise<CollectionResult> {
  if (!Number.isInteger(deps.maxPages) || deps.maxPages < 1) {
    throw new Error("maxPages must be a positive integer.");
  }
  let cursor = await deps.readCursor();
  let pages = 0;
  let posts = 0;
  while (pages < deps.maxPages) {
    if (deps.signal.aborted) return { pages, posts, cursor, completed: false, reason: "stopped" };
    await deps.onPageStart?.();
    pages++;
    const data = await deps.request(homeVariables(cursor), deps.signal);
    const parsed = parseHomeTimeline(data, new Date().toISOString());
    if (!parsed.valid) {
      if (deps.commitFailure) {
        await deps.commitFailure({ page: pages, data, detail: parsed.detail, accounting: parsed.accounting });
      }
      return { pages, posts, cursor, completed: false, reason: "unexpected_shape" };
    }
    if (deps.commitPage) {
      await deps.commitPage({
        page: pages,
        data,
        posts: parsed.posts,
        cursor: parsed.nextCursor,
        accounting: parsed.accounting,
      });
    } else {
      await deps.savePosts(parsed.posts);
    }
    posts += parsed.posts.length;
    deps.report("page " + pages + ": " + parsed.posts.length + " posts"
      + " (entries " + parsed.accounting.total + ", unsupported " + parsed.accounting.unsupported + ")"
      + (parsed.nextCursor === null ? " (end of feed)" : ""));
    if (parsed.nextCursor === null) {
      if (!deps.commitPage) await deps.writeCursor(null);
      return { pages, posts, cursor: null, completed: true, reason: "timeline_complete" };
    }
    if (parsed.nextCursor === cursor) {
      return { pages, posts, cursor, completed: false, reason: "cursor_stalled" };
    }
    cursor = parsed.nextCursor;
    if (!deps.commitPage) await deps.writeCursor(cursor);
    if (pages < deps.maxPages) {
      try {
        await delay((deps.pageDelayMs ?? 2500) + Math.random() * 500, deps.signal);
      } catch (error) {
        if (deps.signal.aborted) return { pages, posts, cursor, completed: false, reason: "stopped" };
        throw error;
      }
    }
  }
  return { pages, posts, cursor, completed: false, reason: "max_pages" };
}
