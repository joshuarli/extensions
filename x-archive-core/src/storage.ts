import { Schema } from "effect";
import { BookmarkSchema, type Bookmark, type Folder, type ProfileInfo } from "./parser.ts";
import { collectMediaJobs } from "./media.ts";
import { PROFILE_OPERATIONS, type ProfileOperation } from "./capture.ts";

type Coverage = "complete" | "partial" | "not_checked";

export interface ScanState {
  started_at: string;
  updated_at: string;
  bookmarks: Coverage;
  folders: Coverage;
  reason: string;
  cursors?: Record<string, string> | undefined;
}

export const ScanStateSchema = Schema.Struct({
  started_at: Schema.String,
  updated_at: Schema.String,
  bookmarks: Schema.Literals(["complete", "partial", "not_checked"]),
  folders: Schema.Literals(["complete", "partial", "not_checked"]),
  reason: Schema.String,
  cursors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export interface LikesScanState {
  started_at: string;
  updated_at: string;
  likes: Coverage;
  reason: string;
  cursors?: Record<string, string> | undefined;
}

export const LikesScanStateSchema = Schema.Struct({
  started_at: Schema.String,
  updated_at: Schema.String,
  likes: Schema.Literals(["complete", "partial", "not_checked"]),
  reason: Schema.String,
  cursors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type ProfileScanProfile = ProfileInfo;

export interface ProfileScanState {
  started_at: string;
  updated_at: string;
  posts: Coverage;
  reason: string;
  operation?: ProfileOperation | undefined;
  profile?: ProfileScanProfile | undefined;
  cursors?: Record<string, string> | undefined;
  completed_operations?: readonly ProfileOperation[] | undefined;
}

const ProfileScanProfileSchema = Schema.Struct({
  user_id: Schema.NullOr(Schema.String),
  screen_name: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  profile_image_url: Schema.NullOr(Schema.String),
  followers_count: Schema.Number,
  verified: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
});

export const ProfileScanStateSchema = Schema.Struct({
  started_at: Schema.String,
  updated_at: Schema.String,
  posts: Schema.Literals(["complete", "partial", "not_checked"]),
  reason: Schema.String,
  operation: Schema.optional(Schema.Literals(PROFILE_OPERATIONS)),
  profile: Schema.optional(ProfileScanProfileSchema),
  cursors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  completed_operations: Schema.optional(Schema.Array(Schema.Literals(PROFILE_OPERATIONS))),
});

export function assembleBookmarkArchive(
  rawBookmarks: unknown[],
  rawFolders: unknown[],
  state: ScanState | null,
  userId: string,
): {
  export_metadata: object;
  folders: Folder[];
  bookmarks: Array<Bookmark & { folders: string[] }>;
} {
  const bookmarks = rawBookmarks.map((record) =>
    Schema.decodeUnknownSync(BookmarkSchema)(record));
  const folders = rawFolders
    .filter((folder): folder is Folder =>
      typeof (folder as Folder | null)?.id === "string"
      && typeof (folder as Folder | null)?.name === "string") as Folder[];
  const names = new Map(folders.map((folder) => [folder.id, folder.name]));
  const withFolders = bookmarks.map((bookmark) => ({
    ...bookmark,
    folders: bookmark.folder_ids.map((id) => names.get(id) ?? id),
  })).sort((a, b) => b.sort_index?.localeCompare(a.sort_index ?? "") ?? -1);
  const available = withFolders.filter((bookmark) => bookmark.status === "available").length;
  return {
    export_metadata: {
      tool: "x-bookmarks",
      schema_version: 2,
      kind: "cumulative",
      exported_at: new Date().toISOString(),
      user_id: userId,
      collection: {
        bookmarks: state?.bookmarks ?? "not_checked",
        folders: state?.folders ?? "not_checked",
        reason: state?.reason ?? "not_scanned",
      },
      stats: {
        total_bookmarks: withFolders.length,
        available_bookmarks: available,
        unavailable_bookmarks: withFolders.length - available,
        total_folders: folders.length,
      },
    },
    folders,
    bookmarks: withFolders,
  };
}

export function assembleLikesArchive(
  rawLikes: unknown[],
  state: LikesScanState | null,
  userId: string,
): {
  export_metadata: object;
  likes: Bookmark[];
} {
  const likes = rawLikes.map((record) =>
    Schema.decodeUnknownSync(BookmarkSchema)(record));
  const withMedia = collectMediaJobs(likes);
  likes.sort((a, b) => b.sort_index?.localeCompare(a.sort_index ?? "") ?? -1);
  const available = likes.filter((like) => like.status === "available").length;
  return {
    export_metadata: {
      tool: "x-likes",
      schema_version: 2,
      kind: "cumulative",
      exported_at: new Date().toISOString(),
      user_id: userId,
      collection: {
        likes: state?.likes ?? "not_checked",
        reason: state?.reason ?? "not_scanned",
      },
      stats: {
        total_likes: likes.length,
        available_likes: available,
        unavailable_likes: likes.length - available,
        media_items: withMedia.jobs.length,
        media_missing: withMedia.missing,
      },
    },
    likes,
  };
}

function stripTarget(record: unknown): unknown {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const { target_user_id: _target, ...rest } = record as Record<string, unknown>;
  return rest;
}

export function assembleProfileArchive(
  rawPosts: unknown[],
  state: ProfileScanState | null,
  accountUserId: string,
  targetUserId: string,
  rawContext?: unknown[],
): {
  export_metadata: object;
  profile: ProfileScanProfile;
  posts: Array<Omit<Bookmark, "folder_ids">>;
  context_posts?: Array<Omit<Bookmark, "folder_ids">>;
} {
  const posts = rawPosts.map((record) =>
    Schema.decodeUnknownSync(BookmarkSchema)(stripTarget(record)));
  const withMedia = collectMediaJobs(posts);
  posts.sort((a, b) => b.sort_index?.localeCompare(a.sort_index ?? "") ?? -1);
  const available = posts.filter((post) => post.status === "available").length;
  const profile = state?.profile ?? {
    user_id: targetUserId,
    screen_name: null,
    name: null,
    profile_image_url: null,
    followers_count: 0,
    verified: false,
    description: null,
  };
  const exported = posts.map(({ folder_ids: _folderIds, ...post }) => post);
  const base = {
    export_metadata: {
      tool: "x-profile-posts",
      schema_version: 1,
      kind: "cumulative",
      exported_at: new Date().toISOString(),
      user_id: accountUserId,
      profile,
      collection: {
        posts: state?.posts ?? "not_checked",
        reason: state?.reason ?? "not_scanned",
        ...(state?.operation ? { operation: state.operation } : {}),
      },
      stats: {
        total_posts: exported.length,
        available_posts: available,
        unavailable_posts: exported.length - available,
        media_items: withMedia.jobs.length,
        media_missing: withMedia.missing,
      },
    },
    profile,
    posts: exported,
  };
  if (rawContext === undefined) return base;
  const context = rawContext.map((record) =>
    Schema.decodeUnknownSync(BookmarkSchema)(stripTarget(record)));
  context.sort((a, b) => b.sort_index?.localeCompare(a.sort_index ?? "") ?? -1);
  const contextPosts = context.map(({ folder_ids: _folderIds, ...post }) => post);
  return {
    ...base,
    export_metadata: {
      ...base.export_metadata,
      stats: {
        ...base.export_metadata.stats,
        context_posts: contextPosts.length,
      },
    },
    context_posts: contextPosts,
  };
}

export type { Bookmark, Folder };
