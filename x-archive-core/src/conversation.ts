import { Schema } from "effect";
import { BookmarkSchema, type Bookmark } from "./parser.ts";

export interface ConversationPage {
  tweets: Array<Record<string, unknown>>;
}

function findWrappedValue(html: string, anchor: string): string | null {
  const i = html.indexOf(anchor);
  if (i < 0) return null;
  const marker = 'value:"';
  const start = html.lastIndexOf(marker, i);
  if (start < 0) return null;
  const begin = start + marker.length;
  let parity = 0;
  for (let j = begin; j < html.length; j++) {
    const ch = html.charAt(j);
    if (ch === "\\") { parity += 1; continue; }
    if (ch === '"' && parity % 2 === 0) return html.slice(begin, j);
    parity = 0;
  }
  return null;
}

function lenientXUnescape(wrapped: string): string {
  let out = "";
  let index = 0;
  while (index < wrapped.length) {
    if (wrapped[index] !== "\\") {
      out += wrapped[index];
      index += 1;
      continue;
    }
    let end = index + 1;
    while (wrapped[end] === "\\") end += 1;
    const backslashes = wrapped.slice(index, end);
    if (backslashes.length % 2 === 1 && wrapped[end] === "x") {
      const hex = wrapped.slice(end + 1, end + 3);
      if (/^[0-9A-Fa-f]{2}$/u.test(hex)) {
        out += backslashes.slice(0, -1) + String.fromCharCode(parseInt(hex, 16));
        index = end + 3;
        continue;
      }
    }
    out += backslashes;
    index = end;
  }
  return out;
}

function parseWrappedValue(wrapped: string): string {
  try {
    return JSON.parse('"' + wrapped + '"');
  } catch {
    return JSON.parse('"' + lenientXUnescape(wrapped) + '"');
  }
}

function unwrapTweetResult(value: unknown): Record<string, unknown> | null {
  let node = value as Record<string, unknown> | null;
  if (node?.["__isTweetResult"] !== "Tweet" && typeof node?.["result"] === "object" && node["result"] !== null) {
    node = node["result"] as Record<string, unknown>;
  }
  if (typeof node?.["rest_id"] !== "string") return null;
  return node;
}

function entryTweets(entry: unknown, sink: Map<string, Record<string, unknown>>): void {
  if (entry === null || typeof entry !== "object") return;
  const content = (entry as Record<string, unknown>)["content"];
  const item = object(content);
  if (!item) return;
  const direct = object(object(item["content"])?.["tweet_results"]);
  const candidates: unknown[] = [];
  if (direct) candidates.push(direct);
  const items = Array.isArray(item["items"]) ? item["items"] as unknown[] : [];
  for (const raw of items) {
    const wrapped = object(object(object(raw)?.["item"])?.["content"]);
    const results = wrapped ? wrapped["tweet_results"] : undefined;
    if (object(results)) candidates.push(results);
  }
  for (const candidate of candidates) {
    const tweet = unwrapTweetResult(candidate);
    if (tweet) sink.set(tweet["rest_id"] as string, tweet);
  }
}

function findEntries(value: unknown, sink: Map<string, Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) findEntries(item, sink);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (Array.isArray(node["entries"])) {
    for (const entry of node["entries"] as unknown[]) entryTweets(entry, sink);
    return;
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (typeof child === "object" && child !== null) findEntries(child, sink);
  }
}

export function extractConversationTweets(html: string): ConversationPage {
  const wrapped = findWrappedValue(html, "threaded_conversation_with_injections_v2");
  if (wrapped === null) throw new Error("X did not serve a conversation payload for this post.");
  const inner = parseWrappedValue(wrapped);
  const parsed = JSON.parse(inner) as Record<string, unknown>;
  const tweets = new Map<string, Record<string, unknown>>();
  findEntries(parsed, tweets);
  return { tweets: [...tweets.values()] };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isoFromMs(value: unknown): string | null {
  const ms = number(value, NaN);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function mapEntities(tweet: Record<string, unknown>) {
  const urlEntities = Array.isArray(tweet["url_entities"]) ? tweet["url_entities"] as Array<Record<string, unknown>> : [];
  const hashtags = Array.isArray(tweet["hashtag_entities"]) ? tweet["hashtag_entities"] as Array<Record<string, unknown>> : [];
  const mentions = Array.isArray(tweet["mention_entities"]) ? tweet["mention_entities"] as Array<Record<string, unknown>> : [];
  return {
    urls: urlEntities.map((entry) => ({
      url: string(entry["url"]) ?? "",
      expanded_url: string(entry["expanded_url"]) ?? null,
      display_url: string(entry["display_url"]) ?? null,
    })).filter((entry) => entry.url),
    hashtags: hashtags.map((entry) => ({ text: string(entry["text"]) ?? "" })).filter((entry) => entry.text),
    mentions: mentions.map((entry) => ({ screen_name: string(entry["screen_name"]) ?? "" })).filter((entry) => entry.screen_name),
  };
}

export function parseContextTweet(
  tweet: Record<string, unknown>,
  conversationId: string,
  observedAt: string,
): Bookmark | null {
  const tweetId = string(tweet["rest_id"]);
  if (!tweetId || !/^\d+$/u.test(tweetId)) return null;
  const details = object(tweet["details"]);
  const legacy = object(tweet["legacy"]);
  const counts = object(tweet["counts"]) ?? {};
  const author = object(object(object(tweet["core"])?.["user_results"])?.["result"]);
  if (!details) return null;
  const core = object(author?.["core"]);
  const replyTo = object(tweet["reply_to_results"]);
  const replyToUser = object(tweet["reply_to_user_results"]);
  const views = object(tweet["views"]);
  const text = string(details["full_text"]) ?? "";
  const createdAt = isoFromMs(details["created_at_ms"]);
  const record = {
    tweet_id: tweetId,
    sort_index: tweetId,
    status: "available" as const,
    created_at: createdAt,
    full_text: text,
    lang: string(legacy?.["lang"]) ?? null,
    source: null,
    conversation_id: conversationId,
    in_reply_to_tweet_id: string(replyTo?.["rest_id"]) ?? null,
    in_reply_to_user_id: string(replyToUser?.["rest_id"]) ?? null,
    author: {
      user_id: string(author?.["rest_id"]) ?? null,
      screen_name: string(core?.["screen_name"]) ?? null,
      name: string(core?.["name"]) ?? null,
      profile_image_url: null,
      verified: Boolean(object(author?.["verification"])?.["is_blue_verified"]),
      followers_count: number(object(author?.["relationship_counts"])?.["followers"]),
    },
    metrics: {
      likes: number(counts["favorite_count"]),
      retweets: number(counts["retweet_count"]),
      replies: number(counts["reply_count"]),
      bookmarks: number(counts["bookmark_count"]),
      views: number(string(views?.["count"])),
    },
    entities: mapEntities(tweet),
    media: [],
    quoted_tweet: null,
    card: null,
    folder_ids: [],
    observed_at: observedAt,
  };
  return Schema.decodeUnknownSync(BookmarkSchema)(record);
}
