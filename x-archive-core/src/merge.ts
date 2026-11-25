import { decodeBookmark } from "./raw.ts";
import type { RawBookmark } from "./parser.ts";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mergedMetrics(old: unknown, incoming: unknown): unknown {
  const next = object(incoming);
  if (!next) return old;
  const merged = { ...(object(old) ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  return merged;
}

export function mergeBookmark(old: RawBookmark | undefined, incoming: RawBookmark, folderId?: string): RawBookmark {
  const ids = new Set([...(old?.folder_ids ?? []), ...incoming.folder_ids]);
  if (folderId) ids.add(folderId);
  const keepOld = old?.status === "available" && incoming.status === "unavailable";
  const preserve = old?.status === "available" && incoming.status === "available" ? {
    ...(!incoming.full_text && old.full_text ? { full_text: old.full_text } : {}),
    ...(!incoming.media || (Array.isArray(incoming.media) && !incoming.media.length) ? { media: old.media } : {}),
    ...(!incoming.quoted_tweet ? { quoted_tweet: old.quoted_tweet } : {}),
    ...(!incoming.card ? { card: old.card } : {}),
    ...(old?.metrics ? { metrics: mergedMetrics(old.metrics, incoming.metrics) } : {}),
  } : {};
  const raw = keepOld && old?.raw_tweet !== undefined ? old.raw_tweet : incoming.raw_tweet ?? old?.raw_tweet;
  const merged: RawBookmark = {
    ...(old ?? {}),
    ...(keepOld ? {} : incoming),
    ...preserve,
    tweet_id: incoming.tweet_id,
    sort_index: incoming.sort_index ?? old?.sort_index ?? null,
    status: keepOld ? "available" : incoming.status,
    folder_ids: [...ids],
    observed_at: incoming.observed_at,
    first_seen_at: old?.first_seen_at ?? incoming.first_seen_at,
    ...(keepOld || incoming.status === "available" ? { unavailable_reason: undefined } : {}),
    ...(raw !== undefined ? { raw_tweet: raw } : {}),
  };
  return decodeBookmark(merged);
}
