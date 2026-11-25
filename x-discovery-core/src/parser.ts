import type { DiscoveredPost, Link } from "./post.ts";

export interface ParsedHomeTimeline {
  valid: boolean;
  posts: DiscoveredPost[];
  nextCursor: string | null;
  detail?: string;
}

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

function post(entry: unknown, observedAt: string): DiscoveredPost | null {
  const result = get(entry, "content", "itemContent", "tweet_results", "result");
  if (get(result, "__typename") !== "Tweet") return null;
  const author = get(result, "core", "user_results", "result");
  if (get(author, "__typename") !== "User") return null;
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
    observed_at: observedAt,
  };
}

export function parseHomeTimeline(data: unknown, observedAt: string): ParsedHomeTimeline {
  const instructions = array(get(data, "data", "home", "home_timeline_urt", "instructions"));
  const addEntries = instructions.find((instruction) => get(instruction, "type") === "TimelineAddEntries");
  if (addEntries === undefined) {
    return { valid: false, posts: [], nextCursor: null, detail: "Home timeline response has no TimelineAddEntries instruction." };
  }
  const entries = array(get(addEntries, "entries"));
  const posts: DiscoveredPost[] = [];
  let nextCursor: string | null = null;
  for (const entry of entries) {
    if (get(entry, "content", "entryType") === "TimelineTimelineCursor") {
      if (get(entry, "content", "cursorType") === "Bottom") {
        nextCursor = string(get(entry, "content", "value")) ?? null;
      }
      continue;
    }
    if (get(entry, "content", "entryType") !== "TimelineTimelineItem") continue;
    if ((string(get(entry, "entryId")) ?? "").startsWith("promoted-")) continue;
    const parsed = post(entry, observedAt);
    if (parsed) posts.push(parsed);
  }
  return { valid: true, posts, nextCursor };
}
