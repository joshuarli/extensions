import { Schema } from "effect";
import { BookmarkSchema, type Bookmark } from "./parser.ts";

export function mergeBookmark(old: Bookmark | undefined, incoming: Bookmark, folderId?: string): Bookmark {
  const ids = new Set([...(old?.folder_ids ?? []), ...incoming.folder_ids]);
  if (folderId) ids.add(folderId);
  const keepOld = old?.status === "available" && incoming.status === "unavailable";
  const preserve = old?.status === "available" && incoming.status === "available" ? {
    ...(!incoming.full_text && old.full_text ? { full_text: old.full_text } : {}),
    ...(!incoming.media || (Array.isArray(incoming.media) && !incoming.media.length) ? { media: old.media } : {}),
    ...(!incoming.quoted_tweet ? { quoted_tweet: old.quoted_tweet } : {}),
    ...(!incoming.card ? { card: old.card } : {}),
  } : {};
  const merged: Bookmark = {
    ...(old ?? {}),
    ...(keepOld ? {} : incoming),
    ...preserve,
    tweet_id: incoming.tweet_id,
    sort_index: incoming.sort_index ?? old?.sort_index ?? null,
    status: keepOld ? "available" : incoming.status,
    folder_ids: [...ids],
    observed_at: incoming.observed_at,
    ...(keepOld || incoming.status === "available" ? { unavailable_reason: undefined } : {}),
  };
  return Schema.decodeUnknownSync(BookmarkSchema)(merged);
}
