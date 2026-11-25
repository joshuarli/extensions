import { decodeBookmark } from "./raw.ts";
import type { RawBookmark } from "./parser.ts";

export function mergeBookmark(old: RawBookmark | undefined, incoming: RawBookmark, folderId?: string): RawBookmark {
  const ids = new Set([...(old?.folder_ids ?? []), ...incoming.folder_ids]);
  if (folderId) ids.add(folderId);
  const keepOld = old?.status === "available" && incoming.status === "unavailable";
  const preserve = old?.status === "available" && incoming.status === "available" ? {
    ...(!incoming.full_text && old.full_text ? { full_text: old.full_text } : {}),
    ...(!incoming.media || (Array.isArray(incoming.media) && !incoming.media.length) ? { media: old.media } : {}),
    ...(!incoming.quoted_tweet ? { quoted_tweet: old.quoted_tweet } : {}),
    ...(!incoming.card ? { card: old.card } : {}),
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
    ...(keepOld || incoming.status === "available" ? { unavailable_reason: undefined } : {}),
    ...(raw !== undefined ? { raw_tweet: raw } : {}),
  };
  return decodeBookmark(merged);
}
