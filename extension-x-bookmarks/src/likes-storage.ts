import { Schema } from "effect";
import { type Bookmark } from "../../x-archive-core/src/parser.ts";
import {
  assembleLikesArchive as assemble,
  LikesScanStateSchema,
  type LikesScanState,
} from "../../x-archive-core/src/storage.ts";
import { mergeBookmark } from "../../x-archive-core/src/merge.ts";

export type { LikesScanState };

export function openLikesArchive(accountUserId: string): Promise<IDBDatabase> {
  if (!/^\d+$/u.test(accountUserId)) return Promise.reject(new Error("Invalid X account ID."));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("x-likes-" + accountUserId, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("likes", { keyPath: "tweet_id" });
      db.createObjectStore("state");
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Could not open likes archive."));
    opening.onblocked = () => reject(new Error("Close other likes exporter tabs and retry."));
  });
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed."));
  });
}

export function saveLikesPage(db: IDBDatabase, likes: Bookmark[]): Promise<void> {
  if (likes.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("likes", "readwrite");
    const store = tx.objectStore("likes");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Likes save failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Likes save aborted."));
    for (const like of likes) {
      const lookup = store.get(like.tweet_id);
      lookup.onsuccess = () => {
        try {
          store.put(mergeBookmark(lookup.result as Bookmark | undefined, like));
        } catch (error) {
          console.error("Invalid likes record", error);
          tx.abort();
        }
      };
    }
  });
}

export async function saveLikesState(db: IDBDatabase, state: LikesScanState): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save likes scan state."));
    tx.onabort = () => reject(tx.error ?? new Error("Likes scan state save aborted."));
    tx.objectStore("state").put(Schema.decodeUnknownSync(LikesScanStateSchema)(state), "latest");
  });
}

export async function loadLikesState(db: IDBDatabase): Promise<LikesScanState | null> {
  const data: unknown = await request(db.transaction("state", "readonly").objectStore("state").get("latest"));
  try {
    return Schema.decodeUnknownSync(LikesScanStateSchema)(data);
  } catch {
    return null;
  }
}

export async function assembleLikesArchive(db: IDBDatabase, userId: string): Promise<{
  export_metadata: object;
  likes: Bookmark[];
}> {
  const [rawLikes, state] = await Promise.all([
    request(db.transaction("likes", "readonly").objectStore("likes").getAll()),
    loadLikesState(db),
  ]);
  return assemble(rawLikes as unknown[], state, userId);
}
