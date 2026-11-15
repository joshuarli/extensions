import { Schema } from "effect";
import { BookmarkSchema, type Bookmark, type ProfileInfo } from "./parser.ts";
import { mergeBookmark } from "./storage.ts";
import { collectMediaJobs } from "./media.ts";

export const PROFILE_POSTS_STORE = "posts";
export const PROFILE_STATE_STORE = "state";

export type Coverage = "complete" | "partial" | "not_checked";

export type ProfileScanProfile = ProfileInfo;

export interface ProfileScanState {
  started_at: string;
  updated_at: string;
  posts: Coverage;
  reason: string;
  operation?: "UserTweets" | "UserTweetsAndReplies" | undefined;
  profile?: ProfileScanProfile | undefined;
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

const ProfileScanStateSchema = Schema.Struct({
  started_at: Schema.String,
  updated_at: Schema.String,
  posts: Schema.Literals(["complete", "partial", "not_checked"]),
  reason: Schema.String,
  operation: Schema.optional(Schema.Literals(["UserTweets", "UserTweetsAndReplies"])),
  profile: Schema.optional(ProfileScanProfileSchema),
});

export type ProfilePost = Bookmark & { target_user_id: string };

export interface SavedProfileTarget {
  targetUserId: string;
  state: ProfileScanState;
  postCount: number;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed."));
  });
}

export function openProfileArchive(accountUserId: string): Promise<IDBDatabase> {
  if (!/^\d+$/u.test(accountUserId)) return Promise.reject(new Error("Invalid X account ID."));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("x-profile-" + accountUserId, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      const posts = db.createObjectStore(PROFILE_POSTS_STORE, { keyPath: ["target_user_id", "tweet_id"] });
      posts.createIndex("by-target", "target_user_id", { unique: false });
      db.createObjectStore(PROFILE_STATE_STORE);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Could not open profile archive."));
    opening.onblocked = () => reject(new Error("Close other exporter tabs and retry."));
  });
}

function stateKey(targetUserId: string): string {
  return "target:" + targetUserId;
}

export function mergeProfilePost(old: ProfilePost | undefined, incoming: Bookmark, targetUserId: string): ProfilePost {
  if (!old) return { ...mergeBookmark(undefined, incoming), target_user_id: targetUserId };
  const { target_user_id: _target, ...previous } = old;
  return { ...mergeBookmark(previous, incoming), target_user_id: targetUserId };
}

export function saveProfilePage(db: IDBDatabase, posts: Bookmark[], targetUserId: string): Promise<void> {
  if (posts.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILE_POSTS_STORE, "readwrite");
    const store = tx.objectStore(PROFILE_POSTS_STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Profile post save failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Profile post save aborted."));
    for (const post of posts) {
      const lookup = store.get([targetUserId, post.tweet_id]);
      lookup.onsuccess = () => {
        try {
          store.put(mergeProfilePost(lookup.result as ProfilePost | undefined, post, targetUserId));
        } catch (error) {
          console.error("Invalid profile post record", error);
          tx.abort();
        }
      };
    }
  });
}

export async function saveProfileState(db: IDBDatabase, targetUserId: string, state: ProfileScanState): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROFILE_STATE_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save profile scan state."));
    tx.onabort = () => reject(tx.error ?? new Error("Profile scan state save aborted."));
    tx.objectStore(PROFILE_STATE_STORE).put(Schema.decodeUnknownSync(ProfileScanStateSchema)(state), stateKey(targetUserId));
  });
}

export async function loadProfileState(db: IDBDatabase, targetUserId: string): Promise<ProfileScanState | null> {
  const data: unknown = await request(
    db.transaction(PROFILE_STATE_STORE, "readonly").objectStore(PROFILE_STATE_STORE).get(stateKey(targetUserId)),
  );
  try {
    return Schema.decodeUnknownSync(ProfileScanStateSchema)(data);
  } catch {
    return null;
  }
}

export async function listProfileStates(db: IDBDatabase): Promise<SavedProfileTarget[]> {
  const keys = await request(db.transaction(PROFILE_STATE_STORE, "readonly").objectStore(PROFILE_STATE_STORE).getAllKeys());
  const targets: SavedProfileTarget[] = [];
  for (const key of keys) {
    if (typeof key !== "string" || !key.startsWith("target:")) continue;
    const targetUserId = key.slice("target:".length);
    if (!/^\d+$/u.test(targetUserId)) continue;
    const state = await loadProfileState(db, targetUserId);
    if (!state) continue;
    targets.push({ targetUserId, state, postCount: await profilePostCount(db, targetUserId) });
  }
  return targets.sort((a, b) => b.state.updated_at.localeCompare(a.state.updated_at));
}

export async function profilePostCount(db: IDBDatabase, targetUserId: string): Promise<number> {
  const index = db.transaction(PROFILE_POSTS_STORE, "readonly").objectStore(PROFILE_POSTS_STORE).index("by-target");
  return request(index.count(targetUserId));
}

function stripTarget(record: unknown): unknown {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const { target_user_id: _target, ...rest } = record as Record<string, unknown>;
  return rest;
}

export async function assembleProfileArchive(db: IDBDatabase, accountUserId: string, targetUserId: string): Promise<{
  export_metadata: object;
  profile: ProfileScanProfile;
  posts: Array<Omit<Bookmark, "folder_ids">>;
}> {
  const [rawPosts, state] = await Promise.all([
    request(db.transaction(PROFILE_POSTS_STORE, "readonly").objectStore(PROFILE_POSTS_STORE)
      .index("by-target").getAll(targetUserId)),
    loadProfileState(db, targetUserId),
  ]);
  const posts = (rawPosts as unknown[]).map((record) =>
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
  return {
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
}
