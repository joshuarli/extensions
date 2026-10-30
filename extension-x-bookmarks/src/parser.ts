import { Schema } from "effect";

export const BookmarkSchema = Schema.Struct({
  tweet_id: Schema.String,
  sort_index: Schema.NullOr(Schema.String),
  status: Schema.Literals(["available", "unavailable"]),
  unavailable_reason: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  full_text: Schema.optional(Schema.String),
  lang: Schema.optional(Schema.NullOr(Schema.String)),
  source: Schema.optional(Schema.NullOr(Schema.String)),
  conversation_id: Schema.optional(Schema.NullOr(Schema.String)),
  in_reply_to_tweet_id: Schema.optional(Schema.NullOr(Schema.String)),
  in_reply_to_user_id: Schema.optional(Schema.NullOr(Schema.String)),
  author: Schema.optional(Schema.Unknown),
  metrics: Schema.optional(Schema.Unknown),
  entities: Schema.optional(Schema.Unknown),
  media: Schema.optional(Schema.Unknown),
  quoted_tweet: Schema.optional(Schema.Unknown),
  card: Schema.optional(Schema.Unknown),
  folder_ids: Schema.Array(Schema.String),
  observed_at: Schema.String,
});

export type Bookmark = Schema.Schema.Type<typeof BookmarkSchema>;
export type Folder = { id: string; name: string };
export type ParsedPage = { valid: boolean; bookmarks: Bookmark[]; nextCursor: string | null };
export type ParsedFolders = { valid: boolean; folders: Folder[]; nextCursor: string | null };

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

function unavailable(id: string, sortIndex: string | null, reason: string, observedAt: string): Bookmark {
  return { tweet_id: id, sort_index: sortIndex, status: "unavailable",
    unavailable_reason: reason, folder_ids: [], observed_at: observedAt };
}

function extractTweet(entry: ObjectValue, observedAt: string): Bookmark | null {
  const entryId = string(entry["entryId"]);
  const id = entryId?.slice("tweet-".length) ?? "";
  const item = get(entry, "content", "itemContent");
  if (!object(item) || !id) return null;
  const sortIndex = string(entry["sortIndex"]);
  let result = get(item, "tweet_results", "result");
  if (!object(result)) return unavailable(id, sortIndex, "No tweet data returned", observedAt);
  if (get(result, "__typename") === "TweetWithVisibilityResults") result = get(result, "tweet");
  if (!object(result) || ["TweetTombstone", "TweetUnavailable"].includes(string(get(result, "__typename")) ?? "")) {
    return unavailable(id, sortIndex, string(get(result, "tombstone", "text", "text")) ?? "Tweet unavailable", observedAt);
  }

  const tweetId = string(get(result, "rest_id")) ?? string(get(result, "legacy", "id_str")) ?? id;
  const legacy = get(result, "legacy");
  const core = get(result, "core", "user_results", "result");
  const userLegacy = get(core, "legacy");
  const note = get(result, "note_tweet", "note_tweet_results", "result");
  const noteText = string(get(note, "text"));
  const entities = get(note, "entity_set") ?? get(legacy, "entities");
  const rawMedia = array(get(legacy, "extended_entities", "media") ?? get(legacy, "entities", "media"));

  const quoted = get(result, "quoted_status_result", "result");
  let quotedTweet: unknown = null;
  if (quoted !== undefined && quoted !== null) {
    const actual = get(quoted, "__typename") === "TweetWithVisibilityResults" ? get(quoted, "tweet") : quoted;
    if (!object(actual) || ["TweetTombstone", "TweetUnavailable"].includes(string(get(actual, "__typename")) ?? "")) {
      quotedTweet = { status: "unavailable" };
    } else {
      const quotedCore = get(actual, "core", "user_results", "result");
      quotedTweet = {
        tweet_id: string(get(actual, "rest_id")) ?? string(get(actual, "legacy", "id_str")),
        full_text: string(get(actual, "note_tweet", "note_tweet_results", "result", "text")) ??
          string(get(actual, "legacy", "full_text")),
        author: {
          screen_name: string(get(quotedCore, "core", "screen_name")) ?? string(get(quotedCore, "legacy", "screen_name")),
          name: string(get(quotedCore, "core", "name")) ?? string(get(quotedCore, "legacy", "name")),
        },
      };
    }
  }

  const bindings: Record<string, string | null> = {};
  for (const binding of array(get(result, "card", "legacy", "binding_values"))) {
    const key = string(get(binding, "key"));
    if (key) bindings[key] = string(get(binding, "value", "string_value")) ??
      string(get(binding, "value", "scribe_value", "description"));
  }
  const card = get(result, "card", "legacy");

  return {
    tweet_id: tweetId,
    sort_index: sortIndex,
    status: "available",
    created_at: string(get(legacy, "created_at")),
    full_text: noteText ?? string(get(legacy, "full_text")) ?? "",
    lang: string(get(legacy, "lang")),
    source: string(get(result, "source")),
    conversation_id: string(get(legacy, "conversation_id_str")),
    in_reply_to_tweet_id: string(get(legacy, "in_reply_to_status_id_str")),
    in_reply_to_user_id: string(get(legacy, "in_reply_to_user_id_str")),
    author: {
      user_id: string(get(core, "rest_id")) ?? string(get(userLegacy, "id_str")),
      screen_name: string(get(core, "core", "screen_name")) ?? string(get(userLegacy, "screen_name")),
      name: string(get(core, "core", "name")) ?? string(get(userLegacy, "name")),
      profile_image_url: string(get(core, "avatar", "image_url")) ?? string(get(userLegacy, "profile_image_url_https")),
      verified: get(core, "is_blue_verified") === true || get(userLegacy, "verified") === true,
      followers_count: number(get(userLegacy, "followers_count")),
    },
    metrics: {
      likes: number(get(legacy, "favorite_count")),
      retweets: number(get(legacy, "retweet_count")),
      replies: number(get(legacy, "reply_count")),
      bookmarks: number(get(legacy, "bookmark_count")),
      views: Number.parseInt(string(get(result, "views", "count")) ?? "0", 10) || 0,
    },
    entities: {
      urls: array(get(entities, "urls")).map((value) => ({
        url: string(get(value, "url")),
        expanded_url: string(get(value, "expanded_url")),
        display_url: string(get(value, "display_url")),
      })),
      hashtags: array(get(entities, "hashtags")).map((value) => string(get(value, "text"))).filter((value) => value !== null),
      mentions: array(get(entities, "user_mentions")).map((value) => ({
        screen_name: string(get(value, "screen_name")),
        user_id: string(get(value, "id_str")),
      })),
    },
    media: rawMedia.map((value) => {
      const type = string(get(value, "type"));
      const base = string(get(value, "media_url_https"));
      return {
        type,
        url: type === "photo" && base ? base + "?format=jpg&name=orig" : base,
        alt_text: string(get(value, "ext_alt_text")),
        ...(type === "video" || type === "animated_gif" ? {
          thumbnail_url: base,
          duration_ms: number(get(value, "video_info", "duration_millis")) || null,
          variants: array(get(value, "video_info", "variants"))
            .filter((variant) => get(variant, "content_type") === "video/mp4")
            .map((variant) => ({
              bitrate: number(get(variant, "bitrate")),
              content_type: "video/mp4",
              url: string(get(variant, "url")),
            }))
            .sort((a, b) => b.bitrate - a.bitrate),
        } : {}),
      };
    }),
    quoted_tweet: quotedTweet,
    card: object(card) ? {
      type: string(get(card, "name")),
      url: bindings["card_url"] ?? bindings["url"] ?? null,
      title: bindings["title"] ?? null,
      description: bindings["description"] ?? null,
    } : null,
    folder_ids: [],
    observed_at: observedAt,
  };
}

export function parseTimeline(data: unknown, observedAt: string): ParsedPage {
  const instructions = get(data, "data", "bookmark_timeline_v2", "timeline", "instructions") ??
    get(data, "data", "bookmark_timeline", "timeline", "instructions") ??
    get(data, "data", "bookmark_collection_timeline", "timeline", "instructions");
  const invalid = (): ParsedPage => ({ valid: false, bookmarks: [], nextCursor: null });
  if (!Array.isArray(instructions)) return invalid();
  const bookmarks: Bookmark[] = [];
  let nextCursor: string | null = null;
  for (const instruction of instructions) {
    const kind = get(instruction, "type");
    if (kind === "TimelineTerminateTimeline") continue;
    if (kind !== "TimelineAddEntries" && kind !== "TimelineReplaceEntry") return invalid();
    const entries: unknown = kind === "TimelineReplaceEntry"
      ? [get(instruction, "entry")] : get(instruction, "entries");
    if (!Array.isArray(entries)) return invalid();
    for (const entry of entries) {
      const id = string(get(entry, "entryId"));
      if (!id || !object(entry)) return invalid();
      if (id.startsWith("tweet-")) {
        const bookmark = extractTweet(entry, observedAt);
        if (!bookmark || !bookmark.tweet_id) return invalid();
        bookmarks.push(bookmark);
      } else if (id.startsWith("cursor-bottom-")) {
        const value = string(get(entry, "content", "value"));
        if (!value) return invalid();
        nextCursor = value;
      } else if (!id.startsWith("cursor-top-")) {
        return invalid();
      }
    }
  }
  return { valid: true, bookmarks, nextCursor };
}

export function parseFolders(data: unknown): ParsedFolders {
  const slice = get(data, "data", "viewer", "user_results", "result", "bookmark_collections_slice");
  if (!object(slice)) return { valid: false, folders: [], nextCursor: null };
  const items = slice["items"];
  const cursor = get(slice, "slice_info", "next_cursor");
  if (!Array.isArray(items) || (cursor != null && typeof cursor !== "string")) {
    return { valid: false, folders: [], nextCursor: null };
  }
  const folders: Folder[] = [];
  for (const item of items) {
    const id = string(get(item, "id")) ?? string(get(item, "collection_id"));
    const name = string(get(item, "name"));
    if (!id || name === null) return { valid: false, folders: [], nextCursor: null };
    folders.push({ id, name });
  }
  return { valid: true, folders, nextCursor: string(cursor) };
}
