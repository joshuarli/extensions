import { join } from "node:path";
import { chromium } from "playwright";
import { Schema } from "effect";
import {
  ScanStateSchema,
  LikesScanStateSchema,
  ProfileScanStateSchema,
  type ScanState,
  type LikesScanState,
  type ProfileScanState,
} from "../../x-archive-core/src/storage.ts";
import { FsBookmarksStore, FsLikesStore } from "./fs-store.ts";
import type { ProfileStore } from "../../x-archive-core/src/collector.ts";
import type { XSession } from "./deps.ts";
import { writeJsonFile, stateDir } from "./state.ts";

export type SeedProfileStore = ProfileStore & { allRecords(): Promise<unknown[]> };

const EXTENSION_ID = "lekmlndhaidgepoalcmbcehffnliclil";

export interface SeedReport {
  bookmarks: { records: number; folders: number; state: ScanState | null; already: boolean };
  likes: { records: number; state: LikesScanState | null; already: boolean };
  profiles: Array<{ targetUserId: string; screenName: string | null; records: number; state: ProfileScanState | null; already: boolean }>;
}

interface CdpDump {
  bookmarks: { records: unknown[]; folders: unknown[]; state: unknown } | null;
  likes: { records: unknown[]; state: unknown } | null;
  profiles: Array<{ targetUserId: string; posts: unknown[]; state: unknown }>;
}

export interface SeedCounts {
  bookmarks: number;
  likes: number;
  profiles: Record<string, number>;
}

async function countsFromExtension(session: XSession, cdpUrl: string): Promise<SeedCounts> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Helium has no browser context to count archives from.");
    const worker = context.serviceWorkers().find((worker) => worker.url().includes(EXTENSION_ID));
    if (!worker) throw new Error("The X Archive extension is not loaded in this Helium.");
    return await worker.evaluate(async (userId: string): Promise<SeedCounts> => {
      const count = (name: string, store: string, index?: string, key?: IDBValidKey) =>
        new Promise<number>((resolvePromise, rejectPromise) => {
          const request = (() => {
            const r = indexedDB.open(name);
            r.onsuccess = () => {
              const db = r.result;
              const objectStore = db.transaction(store, "readonly").objectStore(store);
              const req = index && key !== undefined
                ? objectStore.index(index).count(key)
                : objectStore.count();
              req.onsuccess = () => resolvePromise(req.result as number);
              req.onerror = () => rejectPromise(req.error);
            };
            r.onerror = () => rejectPromise(r.error);
            return r;
          })();
          void request;
        });
      const keys = (name: string, store: string) => new Promise<IDBValidKey[]>((resolvePromise) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => {
          const req = r.result.transaction(store, "readonly").objectStore(store).getAllKeys();
          req.onsuccess = () => resolvePromise(req.result as IDBValidKey[]);
          req.onerror = () => resolvePromise([]);
        };
        r.onerror = () => resolvePromise([]);
      });
      const out: SeedCounts = { bookmarks: 0, likes: 0, profiles: {} };
      try { out.bookmarks = await count("x-bookmarks-" + userId, "bookmarks"); } catch { /* not created */ }
      try { out.likes = await count("x-likes-" + userId, "likes"); } catch { /* not created */ }
      try {
        for (const key of await keys("x-profile-" + userId, "state")) {
          if (typeof key !== "string" || !key.startsWith("target:")) continue;
          const targetUserId = key.slice("target:".length);
          out.profiles[targetUserId] = await count("x-profile-" + userId, "posts", "by-target", targetUserId);
        }
      } catch { /* not created */ }
      return out;
    }, session.userId);
  } finally {
    await browser.close();
  }
}

async function dumpFromExtension(session: XSession, cdpUrl: string): Promise<CdpDump> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Helium has no browser context to seed from.");
    const worker = context.serviceWorkers().find((worker) => worker.url().includes(EXTENSION_ID));
    if (!worker) throw new Error("The X Archive extension is not loaded in this Helium.");
    return await worker.evaluate(async (userId: string): Promise<CdpDump> => {
      const open = (name: string) => new Promise<IDBDatabase>((resolvePromise, rejectPromise) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => rejectPromise(request.error);
      });
      const all = (db: IDBDatabase, store: string) => new Promise<unknown[]>((resolvePromise, rejectPromise) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolvePromise(request.result as unknown[]);
        request.onerror = () => rejectPromise(request.error);
      });
      const get = (db: IDBDatabase, store: string, key: string) => new Promise<unknown>((resolvePromise) => {
        const request = db.transaction(store, "readonly").objectStore(store).get(key);
        request.onsuccess = () => resolvePromise(request.result as unknown);
        request.onerror = () => resolvePromise(null);
      });
      const keys = (db: IDBDatabase, store: string) => new Promise<IDBValidKey[]>((resolvePromise, rejectPromise) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAllKeys();
        request.onsuccess = () => resolvePromise(request.result as IDBValidKey[]);
        request.onerror = () => rejectPromise(request.error);
      });
      const postsFor = (db: IDBDatabase, targetUserId: string) => new Promise<unknown[]>((resolvePromise, rejectPromise) => {
        const request = db.transaction("posts", "readonly").objectStore("posts").index("by-target").getAll(targetUserId);
        request.onsuccess = () => resolvePromise(request.result as unknown[]);
        request.onerror = () => rejectPromise(request.error);
      });

      const out: CdpDump = { bookmarks: null, likes: null, profiles: [] };

      try {
        const db = await open("x-bookmarks-" + userId);
        out.bookmarks = { records: await all(db, "bookmarks"), folders: await all(db, "folders"), state: await get(db, "state", "latest") };
        db.close();
      } catch { /* Extension archive for bookmarks does not exist yet. */ }

      try {
        const db = await open("x-likes-" + userId);
        out.likes = { records: await all(db, "likes"), state: await get(db, "state", "latest") };
        db.close();
      } catch { /* Extension archive for likes does not exist yet. */ }

      try {
        const db = await open("x-profile-" + userId);
        for (const key of await keys(db, "state")) {
          if (typeof key !== "string" || !key.startsWith("target:")) continue;
          const targetUserId = key.slice("target:".length);
          if (!/^\d+$/u.test(targetUserId)) continue;
          out.profiles.push({ targetUserId, posts: await postsFor(db, targetUserId), state: await get(db, "state", "target:" + targetUserId) });
        }
        db.close();
      } catch { /* Extension archive for profiles does not exist yet. */ }

      return out;
    }, session.userId);
  } finally {
    await browser.close();
  }
}

export async function seedFromHelium(
  session: XSession,
  cdpUrl: string,
  options: { onlyProfileTarget?: string; profileStore?: SeedProfileStore } = {},
): Promise<SeedReport> {
  const bookmarksStore = new FsBookmarksStore(session.userId);
  const likesStore = new FsLikesStore(session.userId);

  const counts = await countsFromExtension(session, cdpUrl).catch(() => null);
  const fsBookmarksCount = (await bookmarksStore.allRecords()).length;
  const fsLikesCount = (await likesStore.allRecords()).length;
  const bookmarksOk = counts !== null && counts.bookmarks === fsBookmarksCount;
  const likesOk = counts !== null && counts.likes === fsLikesCount;
  const profileTargetsWanted = options.onlyProfileTarget ? [options.onlyProfileTarget] : [];
  const profileFsCounts: Record<string, number> = {};
  for (const targetUserId of profileTargetsWanted) {
    if (options.profileStore) profileFsCounts[targetUserId] = (await options.profileStore.allRecords()).length;
  }
  const profileCountsOk = counts !== null
    && profileTargetsWanted.every((targetUserId) => counts.profiles[targetUserId] === profileFsCounts[targetUserId]);

  if (counts && bookmarksOk && likesOk && profileCountsOk) {
    const report: SeedReport = {
      bookmarks: { records: fsBookmarksCount, folders: 0, state: await bookmarksStore.loadState(), already: true },
      likes: { records: fsLikesCount, state: await likesStore.loadState(), already: true },
      profiles: [],
    };
    if (options.profileStore) {
      for (const targetUserId of profileTargetsWanted) {
        const state = await options.profileStore.loadState(targetUserId);
        report.profiles.push({
          targetUserId,
          screenName: state?.profile?.screen_name ?? null,
          records: profileFsCounts[targetUserId]!,
          state,
          already: true,
        });
      }
    }
    return report;
  }

  const dump = await dumpFromExtension(session, cdpUrl);
  const report: SeedReport = {
    bookmarks: { records: 0, folders: 0, state: null, already: false },
    likes: { records: 0, state: null, already: false },
    profiles: [],
  };

  const fsBookmarks = await bookmarksStore.allRecords();
  if (dump.bookmarks && dump.bookmarks.records.length > fsBookmarks.length) {
    for (const record of dump.bookmarks.records) await bookmarksStore.savePage([record as never]);
    await bookmarksStore.saveFolders(dump.bookmarks.folders as Array<{ id: string; name: string }>);
    const state = dump.bookmarks.state
      ? Schema.decodeUnknownSync(ScanStateSchema)(dump.bookmarks.state)
      : null;
    if (state) await bookmarksStore.saveState(state);
    report.bookmarks = { records: dump.bookmarks.records.length, folders: dump.bookmarks.folders.length, state, already: false };
  } else {
    report.bookmarks.already = true;
    report.bookmarks.records = fsBookmarks.length;
    report.bookmarks.state = await bookmarksStore.loadState();
    report.bookmarks.folders = await bookmarksStore.allFolders().then((folders) => folders.length);
  }

  const fsLikes = await likesStore.allRecords();
  if (dump.likes && dump.likes.records.length > fsLikes.length) {
    for (const record of dump.likes.records) await likesStore.savePage([record as never]);
    const state = dump.likes.state
      ? Schema.decodeUnknownSync(LikesScanStateSchema)(dump.likes.state)
      : null;
    if (state) await likesStore.saveState(state);
    report.likes = { records: dump.likes.records.length, state, already: false };
  } else {
    report.likes.already = true;
    report.likes.records = fsLikes.length;
    report.likes.state = await likesStore.loadState();
  }

  for (const profile of dump.profiles) {
    if (options.onlyProfileTarget && profile.targetUserId !== options.onlyProfileTarget) continue;
    if (!options.profileStore) continue;
    const store = options.profileStore;
    const existing = await store.allRecords();
    const profileState: ProfileScanState | null = profile.state
      ? Schema.decodeUnknownSync(ProfileScanStateSchema)(profile.state)
      : null;
    const screenName = profileState?.profile?.screen_name ?? null;
    if (profile.posts.length > existing.length) {
      for (const record of profile.posts) await store.savePage([record as never], profile.targetUserId);
      if (profileState) await store.saveState(profile.targetUserId, profileState);
      writeJsonFile(join(stateDir(session.userId), "profile-targets.json"),
        { current: { targetUserId: profile.targetUserId, screenName: screenName ?? undefined, operation: profileState?.operation ?? "UserOriginalsTimeline", capturedAt: new Date().toISOString() } });
      report.profiles.push({ targetUserId: profile.targetUserId, screenName, records: profile.posts.length, state: profileState, already: false });
    } else {
      report.profiles.push({ targetUserId: profile.targetUserId, screenName, records: existing.length, state: await store.loadState(profile.targetUserId), already: true });
    }
  }

  return report;
}
