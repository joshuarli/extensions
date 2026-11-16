import { Schema } from "effect";
import { type Bookmark, type Folder } from "../../x-archive-core/src/parser.ts";
import {
  assembleBookmarkArchive,
  ScanStateSchema,
  type ScanState,
} from "../../x-archive-core/src/storage.ts";
import type { BookmarksStore } from "../../x-archive-core/src/collector.ts";
import { mergeBookmark } from "../../x-archive-core/src/merge.ts";

export { assembleLikesArchive } from "../../x-archive-core/src/storage.ts";
export type { Coverage, LikesScanState, ProfileScanState, ScanState } from "../../x-archive-core/src/storage.ts";
export { mergeBookmark };

export function openArchive(userId: string): Promise<IDBDatabase> {
  if (!/^\d+$/u.test(userId)) return Promise.reject(new Error("Invalid X account ID."));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("x-bookmarks-" + userId, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("bookmarks", { keyPath: "tweet_id" });
      db.createObjectStore("folders", { keyPath: "id" });
      db.createObjectStore("state");
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Could not open bookmark archive."));
    opening.onblocked = () => reject(new Error("Close other bookmark exporter tabs and retry."));
  });
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed."));
  });
}

export function savePage(db: IDBDatabase, bookmarks: Bookmark[], folderId?: string): Promise<void> {
  if (bookmarks.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bookmarks", "readwrite");
    const store = tx.objectStore("bookmarks");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Bookmark save failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Bookmark save aborted."));
    for (const bookmark of bookmarks) {
      const lookup = store.get(bookmark.tweet_id);
      lookup.onsuccess = () => {
        try {
          store.put(mergeBookmark(lookup.result as Bookmark | undefined, bookmark, folderId));
        } catch (error) {
          console.error("Invalid bookmark record", error);
          tx.abort();
        }
      };
    }
  });
}

export function saveFolders(db: IDBDatabase, folders: readonly Folder[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("folders", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Folder save failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Folder save aborted."));
    const store = tx.objectStore("folders");
    for (const folder of folders) store.put(folder);
  });
}

export async function saveState(db: IDBDatabase, state: ScanState): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save scan state."));
    tx.onabort = () => reject(tx.error ?? new Error("Scan state save aborted."));
    tx.objectStore("state").put(Schema.decodeUnknownSync(ScanStateSchema)(state), "latest");
  });
}

export async function loadState(db: IDBDatabase): Promise<ScanState | null> {
  const data: unknown = await request(db.transaction("state", "readonly").objectStore("state").get("latest"));
  try {
    return Schema.decodeUnknownSync(ScanStateSchema)(data);
  } catch {
    return null;
  }
}

export async function bookmarkCount(db: IDBDatabase): Promise<number> {
  return request(db.transaction("bookmarks", "readonly").objectStore("bookmarks").count());
}

export async function assembleArchive(db: IDBDatabase, userId: string): Promise<{
  export_metadata: object;
  folders: Folder[];
  bookmarks: Array<Bookmark & { folders: string[] }>;
}> {
  const [rawBookmarks, rawFolders, state] = await Promise.all([
    request(db.transaction("bookmarks", "readonly").objectStore("bookmarks").getAll()),
    request(db.transaction("folders", "readonly").objectStore("folders").getAll()),
    loadState(db),
  ]);
  return assembleBookmarkArchive(rawBookmarks as unknown[], rawFolders as unknown[], state, userId);
}

export function bookmarksDbStore(db: IDBDatabase): BookmarksStore {
  return {
    savePage: (items, folderId) => savePage(db, items, folderId),
    saveFolders: (folders) => saveFolders(db, folders),
    loadState: () => loadState(db),
    saveState: (state) => saveState(db, state),
  };
}
