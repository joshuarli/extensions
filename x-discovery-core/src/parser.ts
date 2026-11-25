import {
  isTombstone,
  normalizeTweetResult,
  unwrapTweet,
  type Bookmark,
} from "../../x-archive-core/src/parser.ts";
import type { DiscoveredPost, Link, PostRelationship } from "./post.ts";

export interface HomeEntryAccounting {
  total: number;
  posts: number;
  cursors: number;
  nonPost: number;
  unavailable: number;
  unsupported: number;
  postBearingUnsupported: number;
  modulePosts: number;
}

export type ParsedHomeTimeline =
  | { valid: true; posts: DiscoveredPost[]; nextCursor: string | null; accounting: HomeEntryAccounting }
  | { valid: false; detail: string; accounting: HomeEntryAccounting };

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : null;
}

function get(value: unknown, ...keys: string[]): unknown {
  let result = value;
  for (const key of keys) {
    result = object(result)?.[key];
  }
  return result;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function emptyAccounting(): HomeEntryAccounting {
  return { total: 0, posts: 0, cursors: 0, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 };
}

function toPost(bookmark: Bookmark): DiscoveredPost | null {
  if (bookmark.status !== "available") return null;
  const author = object(bookmark.author);
  const authorId = string(author?.["user_id"]);
  const authorHandle = string(author?.["screen_name"]);
  if (!authorId || !authorHandle) return null;
  const entities = object(bookmark.entities);
  const urls: Link[] = (Array.isArray(entities?.["urls"]) ? entities["urls"] : []).flatMap((entry) => {
    const url = string(get(entry, "expanded_url")) ?? string(get(entry, "url"));
    if (!url) return [];
    return [{ url, display_url: string(get(entry, "display_url")) ?? url }];
  });
  const quoted = object(bookmark.quoted_tweet);
  const quotedId = string(quoted?.["tweet_id"]);
  let relationship: PostRelationship = { kind: "original", source_tweet_id: null, source_handle: null };
  if (bookmark.repost_of) {
    relationship = { kind: "repost", source_tweet_id: bookmark.repost_of, source_handle: null };
  } else if (quotedId) {
    const quotedAuthor = object(quoted?.["author"]);
    relationship = {
      kind: "quote",
      source_tweet_id: quotedId,
      source_handle: string(quotedAuthor?.["screen_name"]),
    };
  } else if (bookmark.in_reply_to_tweet_id) {
    relationship = {
      kind: "reply",
      source_tweet_id: bookmark.in_reply_to_tweet_id,
      source_handle: null,
    };
  }
  const metrics = object(bookmark.metrics);
  return {
    tweet_id: bookmark.tweet_id,
    author_id: authorId,
    author_handle: authorHandle,
    author_name: string(author?.["name"]),
    created_at: bookmark.created_at ?? "",
    full_text: bookmark.full_text ?? "",
    lang: bookmark.lang ?? "",
    urls,
    favorite_count: typeof metrics?.["likes"] === "number" ? metrics["likes"] : 0,
    retweet_count: typeof metrics?.["retweets"] === "number" ? metrics["retweets"] : 0,
    relationship,
    observed_at: bookmark.observed_at,
  };
}

type Decoded =
  | { kind: "post"; post: DiscoveredPost }
  | { kind: "unavailable" }
  | { kind: "unsupported" }
  | { kind: "none" };

function decodeResult(result: unknown, observedAt: string): Decoded {
  if (result === null || result === undefined) return { kind: "none" };
  if (!object(result)) return { kind: "unsupported" };
  const unwrapped = unwrapTweet(result);
  if (!unwrapped) return { kind: "unavailable" };
  if (isTombstone(unwrapped)) return { kind: "unavailable" };
  const author = get(unwrapped, "core", "user_results", "result");
  const authorType = string(get(author, "__typename"));
  if (authorType !== null && authorType !== "User") return { kind: "unavailable" };
  const bookmark = normalizeTweetResult(result, observedAt);
  if (!bookmark) return { kind: "unsupported" };
  if (bookmark.status === "unavailable") return { kind: "unavailable" };
  const post = toPost(bookmark);
  return post ? { kind: "post", post } : { kind: "unsupported" };
}

export function parseHomeTimeline(data: unknown, observedAt: string): ParsedHomeTimeline {
  const accounting = emptyAccounting();
  const invalid = (detail: string): ParsedHomeTimeline => ({ valid: false, detail, accounting });
  const instructions = get(data, "data", "home", "home_timeline_urt", "instructions");
  if (!Array.isArray(instructions)) return invalid("Home timeline instructions are missing or not an array; no TimelineAddEntries instruction could be read.");
  const addEntries = instructions.find((instruction) => get(instruction, "type") === "TimelineAddEntries");
  if (addEntries === undefined) return invalid("Home timeline response has no TimelineAddEntries instruction.");
  const entries = get(addEntries, "entries");
  if (!Array.isArray(entries)) return invalid("Home timeline TimelineAddEntries has no entries array.");

  const posts: DiscoveredPost[] = [];
  let nextCursor: string | null = null;
  accounting.total = entries.length;
  for (const entry of entries) {
    if (!object(entry)) return invalid("Home timeline contains a non-object entry.");
    const entryType = get(entry, "content", "entryType");
    if (entryType === "TimelineTimelineCursor") {
      accounting.cursors++;
      if (get(entry, "content", "cursorType") === "Bottom") {
        nextCursor = string(get(entry, "content", "value")) ?? null;
      }
      continue;
    }
    if (entryType === "TimelineTimelineItem") {
      if ((string(get(entry, "entryId")) ?? "").startsWith("promoted-")) {
        accounting.nonPost++;
        continue;
      }
      const decoded = decodeResult(get(entry, "content", "itemContent", "tweet_results", "result"), observedAt);
      if (decoded.kind === "post") {
        posts.push(decoded.post);
        accounting.posts++;
      } else if (decoded.kind === "unavailable") accounting.unavailable++;
      else if (decoded.kind === "unsupported") accounting.postBearingUnsupported++;
      else accounting.nonPost++;
      continue;
    }
    if (entryType === "TimelineTimelineModule") {
      const items = get(entry, "content", "items");
      if (!Array.isArray(items)) {
        accounting.postBearingUnsupported++;
        continue;
      }
      for (const item of items) {
        const decodedItem = decodeResult(get(item, "item", "itemContent", "tweet_results", "result"), observedAt);
        if (decodedItem.kind === "post") {
          posts.push(decodedItem.post);
          accounting.modulePosts++;
          accounting.posts++;
        } else if (decodedItem.kind === "unavailable") accounting.unavailable++;
        else if (decodedItem.kind === "unsupported") accounting.postBearingUnsupported++;
        else accounting.nonPost++;
      }
      continue;
    }
    accounting.unsupported++;
  }
  if (accounting.postBearingUnsupported > 0) {
    return invalid("Home timeline contains " + accounting.postBearingUnsupported
      + " post-bearing entries that no decoder understands.");
  }
  return { valid: true, posts, nextCursor, accounting };
}
