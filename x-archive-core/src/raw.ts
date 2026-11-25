import { Schema } from "effect";
import { BookmarkSchema, normalizeTweetResult, type Bookmark, type RawBookmark } from "./parser.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function rawTweet(record: unknown): unknown {
  return object(record)?.["raw_tweet"];
}

export function decodeBookmark(record: unknown): RawBookmark {
  const decoded = Schema.decodeUnknownSync(BookmarkSchema)(record);
  const raw = rawTweet(record);
  return raw === undefined ? decoded : { ...decoded, raw_tweet: raw };
}

function filled(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === "object") return Object.values(value).some(filled);
  return typeof value === "number" ? Number.isFinite(value) && value !== 0 : value === true;
}

export function rederiveBookmark(record: unknown): RawBookmark {
  const decoded = decodeBookmark(record);
  const raw = decoded.raw_tweet;
  if (raw === undefined || decoded.status !== "available") return decoded;
  const derived = normalizeTweetResult(raw, decoded.observed_at, decoded.tweet_id, decoded.sort_index);
  if (!derived || derived.status !== "available" || derived.tweet_id !== decoded.tweet_id) return decoded;
  const view = { ...decoded };
  for (const [key, value] of Object.entries(derived)) {
    if (key !== "raw_tweet" && filled(value)) Object.assign(view, { [key]: value });
  }
  return {
    ...view,
    status: decoded.status,
    sort_index: decoded.sort_index,
    folder_ids: decoded.folder_ids,
    observed_at: decoded.observed_at,
    raw_tweet: raw,
  };
}

export function normalizedFields(record: RawBookmark): Bookmark {
  const { raw_tweet: _raw, ...normalized } = record;
  return normalized;
}

export function serializeRawTweet(record: RawBookmark): string | null {
  return record.raw_tweet === undefined ? null : JSON.stringify(record.raw_tweet);
}

export function restoreRawTweet(record: unknown, serialized: string | null): RawBookmark {
  const decoded = decodeBookmark(record);
  if (serialized === null) return decoded;
  return { ...decoded, raw_tweet: JSON.parse(serialized) as unknown };
}
