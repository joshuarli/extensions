import { Schema } from "effect";
import { type Bookmark } from "../../x-archive-core/src/parser.ts";
import {
  assembleProfileArchive as assemble,
  ProfileScanStateSchema,
  type ProfileScanState,
} from "../../x-archive-core/src/storage.ts";
import { mergeBookmark } from "../../x-archive-core/src/merge.ts";
import type { ProfileStore } from "../../x-archive-core/src/collector.ts";

const PROFILE_POSTS_STORE = "posts";
const PROFILE_STATE_STORE = "state";

export type { ProfileScanState };
export type ProfilePost = Bookmark & { target_user_id: string };

export interface SavedProfileTarget {
  targetUserId: string;
  state: ProfileScanState;
  postCount: number;
}

export function mergeProfilePost(old: ProfilePost | undefined, incoming: Bookmark, targetUserId: string): ProfilePost {
  if (!old) return { ...mergeBookmark(undefined, incoming), target_user_id: targetUserId };
  const { target_user_id: _target, ...previous } = old;
  return { ...mergeBookmark(previous, incoming), target_user_id: targetUserId };
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

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed."));
  });
}

function stateKey(targetUserId: string): string {
  return "target:" + targetUserId;
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

async function profilePostCount(db: IDBDatabase, targetUserId: string): Promise<number> {
  const index = db.transaction(PROFILE_POSTS_STORE, "readonly").objectStore(PROFILE_POSTS_STORE).index("by-target");
  return request(index.count(targetUserId));
}

export async function assembleProfileArchive(db: IDBDatabase, accountUserId: string, targetUserId: string): Promise<{
  export_metadata: object;
  profile: import("../../x-archive-core/src/storage.ts").ProfileScanProfile;
  posts: Array<Omit<Bookmark, "folder_ids">>;
}> {
  const [rawPosts, state] = await Promise.all([
    request(db.transaction(PROFILE_POSTS_STORE, "readonly").objectStore(PROFILE_POSTS_STORE)
      .index("by-target").getAll(targetUserId)),
    loadProfileState(db, targetUserId),
  ]);
  return assemble(rawPosts as unknown[], state, accountUserId, targetUserId);
}


export function profileDbStore(db: IDBDatabase): ProfileStore {
  return {
    savePage: (items, targetUserId) => saveProfilePage(db, items, targetUserId),
    loadState: (targetUserId) => loadProfileState(db, targetUserId),
    saveState: (targetUserId, state) => saveProfileState(db, targetUserId, state),
    allKnown: async (items, targetUserId) => {
      if (items.length === 0) return false;
      for (const item of items) {
        const key = await request(
          db.transaction(PROFILE_POSTS_STORE, "readonly").objectStore(PROFILE_POSTS_STORE)
            .getKey([targetUserId, item.tweet_id]),
        );
        if (key === undefined) return false;
      }
      return true;
    },
  };
}
