import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { collectLikes } from "../src/collector.ts";
import { assembleLikesArchive, loadLikesState, openLikesArchive } from "../src/likes-storage.ts";
import { likesFolderName } from "../src/profile-export.ts";

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

async function openTestLikesArchive(userId: string): Promise<IDBDatabase> {
  databases.push("x-likes-" + userId);
  return openLikesArchive(userId);
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

const entry = (result: unknown, id: string, sortIndex: string) => ({
  entryId: "tweet-" + id,
  sortIndex,
  content: { itemContent: { tweet_results: { result } } },
});
const cursor = (value: string) => ({ entryId: "cursor-bottom-0", content: { value } });
const page = (entries: unknown[]) => ({
  data: {
    user: {
      result: {
        __typename: "User",
        timeline: {
          timeline: {
            instructions: [{ type: "TimelineAddEntries", entries }],
          },
        },
      },
    },
  },
});

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
    queryIds: { Likes: "q-likes" },
    features: { Likes: "{}" },
  };
}

describe("likes collection", () => {
  it("scans the likes timeline to completion and assembles the cumulative archive", { timeout: 30_000 }, async () => {
    stubChrome();
    credentials();
    const db = await openTestLikesArchive("123"),
      pageA = page([entry({ rest_id: "100", legacy: { full_text: "first liked" } }, "100", "100"), cursor("c1")]),
      pageB = page([entry({ rest_id: "200", legacy: { full_text: "second liked" } }, "200", "200"), cursor("c2")]),
      pageC = page([entry({ rest_id: "300", legacy: { full_text: "third liked" } }, "300", "300")]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = timelineFetch([pageA, pageB, pageC]);
    try {
      const state = await collectLikes({
        userId: "123",
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state.likes).toBe("complete");
      expect(state.reason).toBe("complete");
      expect(state.cursors).toEqual({});
      const archive = await assembleLikesArchive(db, "123");
      expect(archive.likes.map((like) => like.tweet_id)).toEqual(["300", "200", "100"]);
      expect(archive.export_metadata).toMatchObject({
        tool: "x-likes",
        user_id: "123",
        collection: { likes: "complete", reason: "complete" },
        stats: { total_likes: 3, available_likes: 3, unavailable_likes: 0 },
      });
      const saved = await loadLikesState(db);
      expect(saved?.likes).toBe("complete");
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("requests the likes operation with the captured variables", async () => {
    stubChrome();
    credentials();
    const db = await openTestLikesArchive("123");
    const originalFetch = globalThis.fetch;
    const seen: Record<string, unknown>[] = [];
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: unknown) => {
      const variables = JSON.parse(new URL(String(url)).searchParams.get("variables") ?? "{}") as Record<string, unknown>;
      seen.push(variables);
      return new Response(JSON.stringify(page([])), { status: 200 });
    }) as typeof fetch;
    try {
      await collectLikes({ userId: "123", db, signal: new AbortController().signal, report: () => {} });
      expect(seen[0]).toMatchObject({
        userId: "123",
        count: 100,
        includePromotedContent: false,
        withVoice: true,
      });
      expect(seen[0]).not.toHaveProperty("cursor");
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("fails loudly with a clear message when the likes request was never captured", async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { Bookmarks: "q1" },
      features: { Bookmarks: "{}" },
    };
    const db = await openTestLikesArchive("123");
    try {
      await expect(collectLikes({ userId: "123", db, signal: new AbortController().signal, report: () => {} }))
        .rejects.toThrow(/never captured/u);
      const saved = await loadLikesState(db);
      expect(saved?.reason).toMatch(/never captured/u);
      expect(saved?.likes).toBe("partial");
    } finally {
      db.close();
    }
  });

  it("stops cleanly at the terminate instruction", async () => {
    stubChrome();
    credentials();
    const db = await openTestLikesArchive("123"),
      pageA = page([entry({ rest_id: "100", legacy: { full_text: "first" } }, "100", "100"), cursor("c1")]),
      pageB = {
        data: {
          user: {
            result: {
              __typename: "User",
              timeline: {
                timeline: {
                  instructions: [
                    { type: "TimelineAddEntries", entries: [entry({ rest_id: "200", legacy: { full_text: "second" } }, "200", "200")] },
                    { type: "TimelineTerminateTimeline" },
                  ],
                },
              },
            },
          },
        },
      },
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = timelineFetch([pageA, pageB]);
    try {
      const state = await collectLikes({ userId: "123", db, signal: new AbortController().signal, report: () => {} });
      expect(state.likes).toBe("complete");
      const archive = await assembleLikesArchive(db, "123");
      expect(archive.likes.map((like) => like.tweet_id)).toEqual(["200", "100"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });
});

  it("treats an empty page with an echoed cursor as the end of the timeline", { timeout: 30_000 }, async () => {
    stubChrome();
    credentials();
    const db = await openTestLikesArchive("123"),
      pageA = page([entry({ rest_id: "100", legacy: { full_text: "first liked" } }, "100", "100"), cursor("c1")]),
      pageB = page([cursor("c1")]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = timelineFetch([pageA, pageB]);
    try {
      const state = await collectLikes({ userId: "123", db, signal: new AbortController().signal, report: () => {} });
      expect(state.likes).toBe("complete");
      expect(state.reason).toBe("complete");
      const archive = await assembleLikesArchive(db, "123");
      expect(archive.likes.map((like) => like.tweet_id)).toEqual(["100"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("still fails loudly when X repeats a cursor on a non-empty page", { timeout: 30_000 }, async () => {
    stubChrome();
    credentials();
    const db = await openTestLikesArchive("123"),
      pageA = page([entry({ rest_id: "100", legacy: { full_text: "first liked" } }, "100", "100"), cursor("c1")]),
      pageB = page([entry({ rest_id: "200", legacy: { full_text: "second liked" } }, "200", "200"), cursor("c1")]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = timelineFetch([pageA, pageB]);
    try {
      await expect(collectLikes({ userId: "123", db, signal: new AbortController().signal, report: () => {} }))
        .rejects.toThrow(/repeated cursor/u);
      const saved = await loadLikesState(db);
      expect(saved?.likes).toBe("partial");
      expect(saved?.reason).toMatch(/repeated cursor/u);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

describe("likes archive export folder", () => {
  it("uses a likes-<date> folder", () => {
    expect(likesFolderName(new Date("2026-11-16T12:00:00Z"))).toBe("likes-2026-11-16");
  });
});
