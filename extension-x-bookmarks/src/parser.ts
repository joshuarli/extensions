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
  repost_of: Schema.optional(Schema.String),
  folder_ids: Schema.Array(Schema.String),
  observed_at: Schema.String,
});

export type Bookmark = Schema.Schema.Type<typeof BookmarkSchema>;
export type Folder = { id: string; name: string };
export type ParsedPage = { valid: boolean; bookmarks: Bookmark[]; nextCursor: string | null; terminated?: boolean; detail?: string };
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

type MediaItem = {
  type: string | null;
  url: string | null;
  alt_text: string | null;
  thumbnail_url?: string | null;
  duration_ms?: number | null;
  variants?: Array<{ bitrate: number; content_type: "video/mp4"; url: string | null }>;
};

function mediaItems(raw: unknown): MediaItem[] {
  return array(raw).map((value) => {
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
            content_type: "video/mp4" as const,
            url: string(get(variant, "url")),
          }))
          .sort((a, b) => b.bitrate - a.bitrate),
      } : {}),
    };
  });
}

function unwrapTweet(value: unknown): ObjectValue | null {
  const result = object(value);
  if (!result) return null;
  if (get(result, "__typename") === "TweetWithVisibilityResults") return object(get(result, "tweet"));
  return result;
}

function isTombstone(value: ObjectValue): boolean {
  return ["TweetTombstone", "TweetUnavailable"].includes(string(get(value, "__typename")) ?? "");
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
  const rawRepost = get(result, "legacy", "retweeted_status_result", "result") ??
    get(result, "retweeted_status_result", "result");
  const repostOfId = string(get(rawRepost, "rest_id")) ?? string(get(rawRepost, "legacy", "id_str"));
  const repostSource = unwrapTweet(rawRepost);
  if (rawRepost != null && (!repostSource || isTombstone(repostSource))) {
    return {
      ...unavailable(tweetId, sortIndex, "Reposted post is unavailable.", observedAt),
      ...(repostOfId ? { repost_of: repostOfId } : {}),
    };
  }
  const content = repostSource ?? result;
  const repostOf = repostSource ? repostOfId : null;
  const legacy = get(content, "legacy");
  const core = get(content, "core", "user_results", "result");
  const userLegacy = get(core, "legacy");
  const note = get(content, "note_tweet", "note_tweet_results", "result");
  const noteText = string(get(note, "text"));
  const entities = get(note, "entity_set") ?? get(legacy, "entities");
  const rawMedia = array(get(legacy, "extended_entities", "media") ?? get(legacy, "entities", "media"));

  const quoted = get(content, "quoted_status_result", "result");
  let quotedTweet: unknown = null;
  if (quoted !== undefined && quoted !== null) {
    const actual = unwrapTweet(quoted);
    if (!actual || isTombstone(actual)) {
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
        media: mediaItems(get(actual, "legacy", "extended_entities", "media") ?? get(actual, "legacy", "entities", "media")),
      };
    }
  }

  const bindings: Record<string, string | null> = {};
  for (const binding of array(get(content, "card", "legacy", "binding_values"))) {
    const key = string(get(binding, "key"));
    if (key) bindings[key] = string(get(binding, "value", "string_value")) ??
      string(get(binding, "value", "scribe_value", "description"));
  }
  const card = get(content, "card", "legacy") ?? get(result, "card", "legacy");

  return {
    tweet_id: tweetId,
    sort_index: sortIndex,
    status: "available",
    created_at: string(get(legacy, "created_at")),
    full_text: noteText ?? string(get(legacy, "full_text")) ?? "",
    lang: string(get(legacy, "lang")),
    source: string(get(content, "source")) ?? string(get(result, "source")),
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
      views: Number.parseInt(string(get(content, "views", "count")) ?? string(get(result, "views", "count")) ?? "0", 10) || 0,
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
    media: mediaItems(rawMedia),
    quoted_tweet: quotedTweet,
    card: object(card) ? {
      type: string(get(card, "name")),
      url: bindings["card_url"] ?? bindings["url"] ?? null,
      title: bindings["title"] ?? null,
      description: bindings["description"] ?? null,
    } : null,
    ...(repostOf ? { repost_of: repostOf } : {}),
    folder_ids: [],
    observed_at: observedAt,
  };
}

type EntriesResult = { valid: true; entries: unknown[] } | { valid: false; detail: string };

function instructionEntries(instruction: unknown): EntriesResult {
  const kind = string(get(instruction, "type"));
  if (kind === "TimelineTerminateTimeline" || kind === "TimelineClearCache") return { valid: true, entries: [] };
  if (kind !== "TimelineAddEntries" && kind !== "TimelineReplaceEntry" && kind !== "TimelinePinEntry") {
    return { valid: false, detail: "unsupported instruction \"" + (kind ?? "unknown") + "\"" };
  }
  const entries: unknown = kind === "TimelineAddEntries"
    ? get(instruction, "entries") : [get(instruction, "entry")];
  return Array.isArray(entries)
    ? { valid: true, entries }
    : { valid: false, detail: "\"" + kind + "\" instruction has no entries array" };
}



type ModuleResult = { posts: Bookmark[] } | { detail: string };

const UNWRAPPERS = new Set(["TweetWithVisibilityResults", "TweetPreviewDisplay"]);

function unwrapModuleTweet(result: unknown): ObjectValue | null {
  const resultObject = object(result);
  if (!resultObject) return null;
  if (UNWRAPPERS.has(string(get(resultObject, "__typename")) ?? "")) return object(get(resultObject, "tweet"));
  return resultObject;
}

function moduleAuthorId(itemContent: ObjectValue): string | null {
  const result = unwrapModuleTweet(get(itemContent, "tweet_results", "result"));
  if (!result) return null;
  return string(get(result, "core", "user_results", "result", "rest_id"))
    ?? string(get(result, "legacy", "user_id_str"));
}

function modulePosts(entry: ObjectValue, observedAt: string, authorUserId: string | undefined): ModuleResult {
  const items = array(get(entry, "content", "items"));
  const sortIndex = string(entry["sortIndex"]);
  const posts: Bookmark[] = [];
  for (const item of items) {
    const itemObject = object(item);
    if (!itemObject) continue;
    const itemId = string(itemObject["entryId"]);
    const contentObject = object(get(itemObject, "item", "itemContent"));
    if (!contentObject) continue;
    const tweetResult = unwrapModuleTweet(get(contentObject, "tweet_results", "result"));
    if (!tweetResult) continue;
    const typename = string(tweetResult["__typename"]);
    const authorId = moduleAuthorId(contentObject);
    if (!authorId) {
      if (["TweetTombstone", "TweetUnavailable"].includes(typename ?? "")) continue;
      return { detail: "conversation item \"" + (itemId ?? "unknown") + "\" carries a tweet without an author id" };
    }
    if (authorUserId === undefined) return { detail: "conversation module requires an author filter" };
    if (authorId !== authorUserId) continue;
    const tweetId = itemId ? itemId.split("-tweet-").pop() ?? "" : "";
    if (!tweetId) return { detail: "conversation item has no tweet id in its entryId" };
    const bookmark = extractTweet(
      { entryId: "tweet-" + tweetId, sortIndex, content: { itemContent: contentObject } },
      observedAt,
    );
    if (!bookmark || !bookmark.tweet_id) return { detail: "conversation item \"" + itemId + "\" did not match the tweet shape" };
    posts.push(bookmark);
  }
  return { posts };
}

function parseInstructions(instructions: unknown, observedAt: string, authorUserId?: string): ParsedPage {
  const invalid = (detail: string): ParsedPage => ({ valid: false, bookmarks: [], nextCursor: null, detail });
  if (!Array.isArray(instructions)) return invalid("timeline instructions are missing or not an array");
  const bookmarks: Bookmark[] = [];
  let nextCursor: string | null = null;
  let terminated = false;
  for (const instruction of instructions) {
    const kind = string(get(instruction, "type"));
    if (kind === "TimelineTerminateTimeline") terminated = true;
    const parsed = instructionEntries(instruction);
    if (!parsed.valid) return invalid(parsed.detail);
    for (const entry of parsed.entries) {
      const entryObject = object(entry);
      if (!entryObject) return invalid("stream contained a non-object entry");
      const id = string(entryObject["entryId"]);
      if (!id) return invalid("timeline entry has no entryId");
      if (id.startsWith("tweet-")) {
        const bookmark = extractTweet(entryObject, observedAt);
        if (!bookmark || !bookmark.tweet_id) return invalid("entry \"" + id + "\" did not match the tweet shape");
        bookmarks.push(bookmark);
      } else if (id.startsWith("profile-conversation-")) {
        const module = modulePosts(entryObject, observedAt, authorUserId);
        if ("detail" in module) return invalid(module.detail);
        bookmarks.push(...module.posts);
      } else if (id.startsWith("cursor-bottom-")) {
        const value = string(get(entryObject, "content", "value"));
        if (!value) return invalid("cursor entry \"" + id + "\" has no content.value");
        nextCursor = value;
      } else {
        continue;
      }
    }
  }
  return { valid: true, bookmarks, nextCursor, terminated };
}

export function parseTimeline(data: unknown, observedAt: string): ParsedPage {
  const instructions = get(data, "data", "bookmark_timeline_v2", "timeline", "instructions") ??
    get(data, "data", "bookmark_timeline", "timeline", "instructions") ??
    get(data, "data", "bookmark_collection_timeline", "timeline", "instructions");
  return parseInstructions(instructions, observedAt, undefined);
}

export interface ProfileInfo {
  user_id: string | null;
  screen_name: string | null;
  name: string | null;
  profile_image_url: string | null;
  description: string | null;
  followers_count: number;
  verified: boolean;
}

export type ParsedProfilePage =
  | { valid: true; posts: Bookmark[]; nextCursor: string | null; terminated: boolean; profile: ProfileInfo | null }
  | { valid: false; posts: []; nextCursor: null; terminated: false; profile: null; detail?: string };

export function parseProfileInfo(source: unknown): ProfileInfo | null {
  if (!object(source)) return null;
  const core = get(source, "core");
  const legacy = get(source, "legacy");
  return {
    user_id: string(get(source, "rest_id")) ?? string(get(legacy, "id_str")),
    screen_name: string(get(core, "screen_name")) ?? string(get(legacy, "screen_name")),
    name: string(get(core, "name")) ?? string(get(legacy, "name")),
    profile_image_url: string(get(source, "avatar", "image_url")) ?? string(get(legacy, "profile_image_url_https")),
    description: string(get(legacy, "description")),
    followers_count: number(get(legacy, "followers_count")),
    verified: get(source, "is_blue_verified") === true || get(legacy, "verified") === true,
  };
}

export function parseProfileTimeline(data: unknown, observedAt: string, authorUserId?: string): ParsedProfilePage {
  const source = get(data, "data", "user", "result");
  if (!object(source)) {
    return { valid: false, posts: [], nextCursor: null, terminated: false, profile: null,
      detail: "response has no data.user.result" };
  }
  const typename = string(get(source, "__typename"));
  const instructions = get(source, "timeline", "timeline", "instructions") ??
    get(source, "timeline_v2", "timeline", "instructions");
  if (instructions === undefined) {
    return { valid: false, posts: [], nextCursor: null, terminated: false, profile: null,
      detail: "no timeline instructions at timeline.timeline.instructions or timeline_v2.timeline.instructions (result __typename=" + (typename ?? "missing") + ")" };
  }
  const base = parseInstructions(instructions, observedAt, authorUserId);
  if (!base.valid) {
    return { valid: false, posts: [], nextCursor: null, terminated: false, profile: null,
      ...(base.detail ? { detail: base.detail } : {}) };
  }
  return { valid: true, posts: base.bookmarks, nextCursor: base.nextCursor, terminated: base.terminated === true, profile: parseProfileInfo(source) };
}

export function parseFolders(data: unknown): ParsedFolders {
  const slice = object(get(data, "data", "viewer", "user_results", "result", "bookmark_collections_slice"));
  if (!slice) return { valid: false, folders: [], nextCursor: null };
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
