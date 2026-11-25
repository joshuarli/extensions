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
  reposted_by: Schema.optional(Schema.Unknown),
  repost_of: Schema.optional(Schema.String),
  folder_ids: Schema.Array(Schema.String),
  observed_at: Schema.String,
});

export type Bookmark = Schema.Schema.Type<typeof BookmarkSchema>;
export type RawBookmark = Bookmark & { readonly raw_tweet?: unknown };
export type Folder = { id: string; name: string };
export type ParsedPage = { valid: boolean; bookmarks: RawBookmark[]; nextCursor: string | null; terminated?: boolean; detail?: string };
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
    const formatMatch = base?.match(/\.([A-Za-z0-9]{2,5})(?:$|\?)/u);
    const format = (formatMatch?.[1]?.toLowerCase() === "jpeg" ? "jpg" : formatMatch?.[1]?.toLowerCase()) ?? "jpg";
    return {
      type,
      url: type === "photo" && base ? base + "?format=" + format + "&name=orig" : base,
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

const TWEET_WRAPPERS = new Set(["TweetWithVisibilityResults", "TweetPreviewDisplay"]);
const TOMBSTONES = new Set(["TweetTombstone", "TweetUnavailable"]);

export function unwrapTweet(value: unknown): ObjectValue | null {
  const result = object(value);
  if (!result) return null;
  return TWEET_WRAPPERS.has(string(get(result, "__typename")) ?? "")
    ? object(get(result, "tweet"))
    : result;
}

export function isTombstone(value: ObjectValue): boolean {
  return TOMBSTONES.has(string(get(value, "__typename")) ?? "");
}

export function normalizeTweetResult(
  result: unknown,
  observedAt: string,
  fallbackId = "",
  sortIndex: string | null = null,
): RawBookmark | null {
  const normalized = normalizeTweetFields(result, observedAt, fallbackId, sortIndex);
  return !normalized || !object(result) ? normalized : { ...normalized, raw_tweet: result };
}

function normalizeTweetFields(
  result: unknown,
  observedAt: string,
  fallbackId: string,
  sortIndex: string | null,
): Bookmark | null {
  const raw = object(result);
  if (!raw) return fallbackId ? unavailable(fallbackId, sortIndex, "No tweet data returned", observedAt) : null;
  const tweet = unwrapTweet(raw);
  if (!tweet) {
    return unavailable(string(get(raw, "rest_id")) ?? fallbackId, sortIndex, "No tweet data returned", observedAt);
  }
  if (isTombstone(tweet)) {
    const id = string(get(tweet, "rest_id")) ?? fallbackId;
    return id ? unavailable(id, sortIndex, string(get(tweet, "tombstone", "text", "text")) ?? "Tweet unavailable", observedAt) : null;
  }

  const tweetId = string(get(tweet, "rest_id")) ?? string(get(tweet, "legacy", "id_str")) ?? fallbackId;
  if (!tweetId) return null;
  const rawRepost = get(tweet, "legacy", "retweeted_status_result", "result") ??
    get(tweet, "retweeted_status_result", "result");
  const repostOfId = string(get(rawRepost, "rest_id")) ?? string(get(rawRepost, "legacy", "id_str"));
  const repostSource = unwrapTweet(rawRepost);
  if (rawRepost != null && (!repostSource || isTombstone(repostSource))) {
    return {
      ...unavailable(tweetId, sortIndex, "Reposted post is unavailable.", observedAt),
      ...(repostOfId ? { repost_of: repostOfId } : {}),
    };
  }
  const content = repostSource ?? tweet;
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
    const actual = unwrapTweet(quoted),
      normalized = actual && !isTombstone(actual) ? normalizeTweetResult(actual, observedAt) : null;
    if (!normalized) {
      quotedTweet = { status: "unavailable" };
    } else {
      const { raw_tweet: _quotedRaw, ...fields } = normalized;
      quotedTweet = fields;
    }
  }

  const repostAuthorCore = get(tweet, "core", "user_results", "result"),
    repostAuthorLegacy = get(repostAuthorCore, "legacy"),
    repostedBy = repostSource ? {
      user_id: string(get(repostAuthorCore, "rest_id")) ?? string(get(repostAuthorLegacy, "id_str")),
      screen_name: string(get(repostAuthorCore, "core", "screen_name")) ?? string(get(repostAuthorLegacy, "screen_name")),
      name: string(get(repostAuthorCore, "core", "name")) ?? string(get(repostAuthorLegacy, "name")),
    } : null;

  const bindings: Record<string, string | null> = {};
  for (const binding of array(get(content, "card", "legacy", "binding_values"))) {
    const key = string(get(binding, "key"));
    if (key) bindings[key] = string(get(binding, "value", "string_value")) ??
      string(get(binding, "value", "scribe_value", "description"));
  }
  const card = get(content, "card", "legacy") ?? get(tweet, "card", "legacy");

  return {
    tweet_id: tweetId,
    sort_index: sortIndex,
    status: "available",
    created_at: string(get(legacy, "created_at")),
    full_text: noteText ?? string(get(legacy, "full_text")) ?? "",
    lang: string(get(legacy, "lang")),
    source: string(get(content, "source")) ?? string(get(tweet, "source")),
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
      views: Number.parseInt(string(get(content, "views", "count")) ?? string(get(tweet, "views", "count")) ?? "0", 10) || 0,
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
      bindings: Object.fromEntries(Object.entries(bindings).filter(([, value]) => value !== null)),
    } : null,
    ...(repostOf ? { repost_of: repostOf } : {}),
    ...(repostedBy ? { reposted_by: repostedBy } : {}),
    folder_ids: [],
    observed_at: observedAt,
  };
}

function extractTweet(entry: ObjectValue, observedAt: string): Bookmark | null {
  const entryId = string(entry["entryId"]);
  const id = entryId?.slice("tweet-".length) ?? "";
  const item = get(entry, "content", "itemContent");
  if (!object(item) || !id) return null;
  return normalizeTweetResult(
    get(item, "tweet_results", "result"),
    observedAt,
    id,
    string(entry["sortIndex"]),
  );
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



type ModuleResult = { posts: RawBookmark[] } | { detail: string };

function unwrapModuleTweet(result: unknown): ObjectValue | null {
  return unwrapTweet(result);
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
  const posts: RawBookmark[] = [];
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
  const bookmarks: RawBookmark[] = [];
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
  | { valid: true; posts: RawBookmark[]; nextCursor: string | null; terminated: boolean; profile: ProfileInfo | null }
  | { valid: false; posts: []; nextCursor: null; terminated: false; profile: null; detail?: string };

function parseProfileInfo(source: unknown): ProfileInfo | null {
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

export interface ListedUser {
  user_id: string;
  handle: string;
  name: string | null;
  observed_at: string;
}

export interface ParsedUserList {
  valid: boolean;
  users: ListedUser[];
  nextCursor: string | null;
  unsupported: number;
  detail?: string;
}

export function parseUserList(data: unknown, observedAt: string): ParsedUserList {
  const instructions = array(get(data, "data", "user", "result", "timeline", "timeline", "instructions"));
  const addEntries = instructions.find((instruction) => get(instruction, "type") === "TimelineAddEntries");
  if (addEntries === undefined) {
    return { valid: false, users: [], nextCursor: null, unsupported: 0,
      detail: "User list response has no TimelineAddEntries instruction." };
  }
  const users: ListedUser[] = [];
  let nextCursor: string | null = null;
  let unsupported = 0;
  for (const entry of array(get(addEntries, "entries"))) {
    const content = get(entry, "content");
    if (get(content, "entryType") === "TimelineTimelineCursor") {
      if (get(content, "cursorType") === "Bottom") nextCursor = string(get(content, "value")) ?? null;
      continue;
    }
    if (get(content, "entryType") !== "TimelineTimelineItem") {
      unsupported++;
      continue;
    }
    const user = get(content, "itemContent", "user_results", "result");
    if (get(user, "__typename") !== "User") {
      unsupported++;
      continue;
    }
    const userId = string(get(user, "rest_id"));
    const handle = string(get(user, "core", "screen_name"));
    if (!userId || !handle) {
      unsupported++;
      continue;
    }
    users.push({ user_id: userId, handle, name: string(get(user, "core", "name")), observed_at: observedAt });
  }
  return { valid: true, users, nextCursor, unsupported };
}
