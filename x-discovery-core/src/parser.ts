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

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function links(raw: unknown): Link[] {
  return array(raw).flatMap((entry) => {
    const url = string(get(entry, "expanded_url"));
    if (!url) return [];
    return [{ url, display_url: string(get(entry, "display_url")) ?? url }];
  });
}

function relationship(result: unknown): PostRelationship {
  const legacy = object(get(result, "legacy"));
  const sourceHandle = (value: unknown): string | null =>
    string(get(value, "core", "user_results", "result", "core", "screen_name"));
  const retweet = get(legacy, "retweeted_status_result", "result");
  if (retweet && get(retweet, "__typename") === "Tweet") {
    return { kind: "repost", source_tweet_id: string(get(retweet, "rest_id")), source_handle: sourceHandle(retweet) };
  }
  const quoted = get(result, "quoted_status_result", "result") ?? get(legacy, "quoted_status_result", "result");
  if (quoted && get(quoted, "__typename") === "Tweet") {
    return { kind: "quote", source_tweet_id: string(get(quoted, "rest_id")), source_handle: sourceHandle(quoted) };
  }
  if (string(get(legacy, "in_reply_to_status_id_str"))) {
    return {
      kind: "reply",
      source_tweet_id: string(get(legacy, "in_reply_to_status_id_str")),
      source_handle: string(get(legacy, "in_reply_to_screen_name")),
    };
  }
  return { kind: "original", source_tweet_id: null, source_handle: null };
}

function post(result: unknown, author: unknown, observedAt: string): DiscoveredPost | null {
  const tweetId = string(get(result, "rest_id"));
  const authorId = string(get(author, "rest_id"));
  const authorHandle = string(get(author, "core", "screen_name"));
  if (!tweetId || !authorId || !authorHandle) return null;
  const legacy = object(get(result, "legacy"));
  return {
    tweet_id: tweetId,
    author_id: authorId,
    author_handle: authorHandle,
    author_name: string(get(author, "core", "name")),
    created_at: string(get(legacy, "created_at")) ?? "",
    full_text: string(get(legacy, "full_text")) ?? "",
    lang: string(get(legacy, "lang")) ?? "",
    urls: links(get(legacy, "entities", "urls")),
    favorite_count: number(get(legacy, "favorite_count")),
    retweet_count: number(get(legacy, "retweet_count")),
    relationship: relationship(result),
    observed_at: observedAt,
  };
}

function emptyAccounting(): HomeEntryAccounting {
  return { total: 0, posts: 0, cursors: 0, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 };
}

export function parseHomeTimeline(data: unknown, observedAt: string): ParsedHomeTimeline {
  const instructions = array(get(data, "data", "home", "home_timeline_urt", "instructions"));
  const addEntries = instructions.find((instruction) => get(instruction, "type") === "TimelineAddEntries");
  const accounting = emptyAccounting();
  if (addEntries === undefined) {
    return { valid: false, detail: "Home timeline response has no TimelineAddEntries instruction.", accounting };
  }
  const entries = array(get(addEntries, "entries"));
  const posts: DiscoveredPost[] = [];
  let nextCursor: string | null = null;
  accounting.total = entries.length;
  for (const entry of entries) {
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
      const result = get(entry, "content", "itemContent", "tweet_results", "result");
      const author = get(result, "core", "user_results", "result");
      if (get(result, "__typename") !== "Tweet" || get(author, "__typename") !== "User") {
        accounting.unavailable++;
        continue;
      }
      const parsed = post(result, author, observedAt);
      if (!parsed) {
        accounting.unavailable++;
        continue;
      }
      posts.push(parsed);
      accounting.posts++;
      continue;
    }
    if (entryType === "TimelineTimelineModule") {
      const items = array(get(entry, "content", "items"));
      let decoded = 0;
      for (const item of items) {
        const result = get(item, "item", "itemContent", "tweet_results", "result");
        const author = get(result, "core", "user_results", "result");
        if (get(result, "__typename") !== "Tweet" || get(author, "__typename") !== "User") {
          accounting.unavailable++;
          continue;
        }
        const parsed = post(result, author, observedAt);
        if (!parsed) {
          accounting.unavailable++;
          continue;
        }
        posts.push(parsed);
        decoded++;
        accounting.modulePosts++;
        accounting.posts++;
      }
      if (decoded === 0) {
        const carriesPost = items.some((item) =>
          get(item, "item", "itemContent", "tweet_results", "result") !== undefined);
        if (carriesPost) accounting.postBearingUnsupported++;
        else accounting.nonPost++;
      }
      continue;
    }
    accounting.unsupported++;
  }
  if (accounting.postBearingUnsupported > 0) {
    return {
      valid: false,
      detail: "Home timeline contains " + accounting.postBearingUnsupported + " post-bearing modules that no decoder understands.",
      accounting,
    };
  }
  return { valid: true, posts, nextCursor, accounting };
}
