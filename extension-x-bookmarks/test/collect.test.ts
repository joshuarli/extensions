import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { collect, collectTimeline } from "../src/collector.ts";
import { assembleArchive, bookmarkCount, loadState, openArchive } from "../src/storage.ts";

let twid: string | null = "u=123";
const stored: Record<string, unknown> = {};

function stubChrome(): void {
  (globalThis as Record<string, unknown>)["chrome"] = {
    cookies: {
      get: async ({ name }: { name: string }) => {
        if (name === "twid") return twid === null ? null : { value: twid };
        if (name === "ct0") return { value: "csrf-value" };
        return null;
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(stored, items),
      },
    },
  };
}

const databases: string[] = [];

async function openTestArchive(userId: string): Promise<IDBDatabase> {
  databases.push("x-bookmarks-" + userId);
  return openArchive(userId);
}

afterEach(async () => {
  delete (globalThis as Record<string, unknown>)["chrome"];
  for (const key of Object.keys(stored)) delete stored[key];
  twid = "u=123";
  for (const name of databases.splice(0)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }
});

const entry = (result: unknown, id = "123") => ({
  entryId: "tweet-" + id, sortIndex: "999", content: { itemContent: { tweet_results: { result } } },
});
const page = (entries: unknown[], key = "bookmark_timeline_v2") => ({
  data: { [key]: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } },
});
const cursor = (value: string) => ({ entryId: "cursor-bottom-0", content: { value } });

function timelineFetch(pages: unknown[]): typeof fetch {
  let calls = 0;
  return (async () => {
    const body = pages[Math.min(calls, pages.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

function credentials(): void {
  stored["x_bookmarks_credentials_123"] = {
    authorization: "Bearer token",
    queryIds: { Bookmarks: "q1" },
    features: { Bookmarks: "{}" },
  };
}

describe("bookmark collection", () => {
  it("scans one bookmark page and records folder follow-up state", async () => {
    stubChrome();
    credentials();
    const db = await openTestArchive("123"),
      fetchImpl = timelineFetch([page([entry({ rest_id: "123", legacy: { full_text: "Hello" } })])]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const state = await collect({
        userId: "123",
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state.bookmarks).toBe("complete");
      expect(state.reason).toBe("folder_query_not_captured");
      expect(await bookmarkCount(db)).toBe(1);
      const saved = await loadState(db);
      expect(saved?.reason).toBe("folder_query_not_captured");
      const archive = await assembleArchive(db, "123");
      expect(archive.bookmarks.map((bookmark) => bookmark.full_text)).toEqual(["Hello"]);
      expect(archive.export_metadata).toMatchObject({
        tool: "x-bookmarks",
        user_id: "123",
        stats: { total_bookmarks: 1, available_bookmarks: 1 },
      });
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("follows cursors across pages", async () => {
    stubChrome();
    credentials();
    const db = await openTestArchive("123"),
      fetchImpl = timelineFetch([
        page([entry({ rest_id: "1", legacy: { full_text: "First" } }), cursor("c1")]),
        page([entry({ rest_id: "2", legacy: { full_text: "Second" } }, "2")]),
      ]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const total = await collectTimeline(
        { userId: "123", db, signal: new AbortController().signal, report: () => {} },
        "Bookmarks",
      );
      expect(total).toBe(2);
      expect(await bookmarkCount(db)).toBe(2);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("collects folder names and timelines to completion", async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { Bookmarks: "q1", BookmarkFoldersSlice: "qf", BookmarkFolderTimeline: "qt" },
      features: { Bookmarks: "{}", BookmarkFoldersSlice: "{}", BookmarkFolderTimeline: "{}" },
    };
    const db = await openTestArchive("123"),
      fetchImpl = (async (url: string) => {
        if (url.includes("/qf/BookmarkFoldersSlice")) {
          return new Response(JSON.stringify({ data: { viewer: { user_results: { result: {
            bookmark_collections_slice: { items: [{ id: "f1", name: "Research" }] },
          } } } } }), { status: 200 });
        }
        if (url.includes("/qt/BookmarkFolderTimeline")) {
          return new Response(JSON.stringify(page(
            [entry({ rest_id: "7", legacy: { full_text: "Folder post" } }, "7")],
            "bookmark_collection_timeline",
          )), { status: 200 });
        }
        return new Response(JSON.stringify(page([])), { status: 200 });
      }) as typeof fetch,
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const state = await collect({
        userId: "123",
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state).toMatchObject({ bookmarks: "complete", folders: "complete", reason: "complete" });
      const archive = await assembleArchive(db, "123");
      expect(archive.folders).toEqual([{ id: "f1", name: "Research" }]);
      expect(archive.bookmarks.map((bookmark) => bookmark.folders)).toEqual([["Research"]]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("stops loudly when the account changes mid-scan", async () => {
    stubChrome();
    credentials();
    const db = await openTestArchive("123"),
      fetchImpl = timelineFetch([page([entry({ rest_id: "1", legacy: { full_text: "First" } })])]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    twid = "u=999";
    try {
      await expect(
        collectTimeline(
          { userId: "123", db, signal: new AbortController().signal, report: () => {} },
          "Bookmarks",
        ),
      ).rejects.toMatchObject({ _tag: "RequestFailure", kind: "auth" });
      expect(await bookmarkCount(db)).toBe(0);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });
});
