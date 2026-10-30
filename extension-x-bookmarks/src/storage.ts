import { Schema } from "effect";
import { BookmarkSchema, type Bookmark, type Folder } from "./parser.ts";

export type Coverage = "complete" | "partial" | "not_checked";

export interface ScanState {
  started_at: string;
  updated_at: string;
  bookmarks: Coverage;
  folders: Coverage;
  reason: string;
}

const ScanStateSchema = Schema.Struct({
  started_at: Schema.String,
  updated_at: Schema.String,
  bookmarks: Schema.Literals(["complete", "partial", "not_checked"]),
  folders: Schema.Literals(["complete", "partial", "not_checked"]),
  reason: Schema.String,
});

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed."));
  });
}

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
  const bookmarks = (rawBookmarks as unknown[]).map((record) =>
    Schema.decodeUnknownSync(BookmarkSchema)(record));
  const folders = (rawFolders as Folder[]).filter((folder) =>
    typeof folder.id === "string" && typeof folder.name === "string");
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
