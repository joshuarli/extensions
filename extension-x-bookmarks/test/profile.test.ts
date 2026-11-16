import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProfile } from "../src/collector.ts";
import { openProfileArchive, assembleProfileArchive, mergeProfilePost, listProfileStates } from "../src/profile-storage.ts";
import { collectMediaJobs } from "../src/media.ts";
import { downloadPostsMedia, exportFolderName } from "../src/profile-export.ts";
import { parseProfileTimeline } from "../src/parser.ts";
import type { Bookmark } from "../src/parser.ts";

const userId = "123";
const targetUserId = "44196397";

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

async function openTestProfileArchive(): Promise<IDBDatabase> {
  databases.push("x-profile-" + userId);
  return openProfileArchive(userId);
}

afterEach(async () => {
  delete (globalThis as Record<string, unknown>)["chrome"];
  for (const key of Object.keys(stored)) delete stored[key];
  twid = "u=123";
  vi.restoreAllMocks();
  for (const name of databases.splice(0)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }
});

const entry = (result: unknown, id = "100") => ({
  entryId: "tweet-" + id, sortIndex: id, content: { itemContent: { tweet_results: { result } } },
});
const cursor = (value: string) => ({ entryId: "cursor-bottom-0", content: { value } });
const profilePage = (entries: unknown[]) => ({
  data: {
    user: {
      result: {
        rest_id: targetUserId,
        core: { screen_name: "someone", name: "Some One" },
        legacy: { followers_count: 42 },
        timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } },
      },
    },
  },
});

function credentials(operation: "UserTweets" | "UserTweetsAndReplies" = "UserTweetsAndReplies"): void {
  stored["x_bookmarks_credentials_" + userId] = {
    authorization: "Bearer token",
    queryIds: { [operation]: "q-profile" },
    features: { [operation]: "{}" },
  };
}

function seedProfileTarget(targetOperations = "UserTweetsAndReplies"): void {
  stored["x_profile_target_" + userId] = {
    targetUserId,
    operation: targetOperations,
    capturedAt: "2026-11-15T00:00:00.000Z",
  };
}

function timelineFetch(pages: unknown[]): typeof fetch {
  let calls = 0;
  return (async () => {
    const body = pages[Math.min(calls, pages.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("profile timeline parsing", () => {
  it("extracts posts, cursor and profile info from the user timeline shape", () => {
    const data = profilePage([entry({ rest_id: "100", legacy: { full_text: "Hello world" } }, "100"), cursor("next-cursor")]);
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nextCursor).toBe("next-cursor");
    expect(result.posts[0]?.full_text).toBe("Hello world");
    expect(result.profile).toMatchObject({ user_id: targetUserId, screen_name: "someone", name: "Some One", followers_count: 42 });
  });

  it("unwraps reposts, keeping the wrapper id and the reposted content", () => {
    const data = profilePage([entry({
      rest_id: "900",
      legacy: {
        full_text: "RT @other: original",
        retweeted_status_result: { result: {
          rest_id: "555",
          legacy: {
            full_text: "the original post",
            extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/pic.jpg" }] },
          },
          core: { user_results: { result: { core: { screen_name: "other", name: "Other" } } } },
        } },
      },
    }, "900")]);
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const post = result.posts[0];
    expect(post?.tweet_id).toBe("900");
    expect(post?.repost_of).toBe("555");
    expect(post?.full_text).toBe("the original post");
    expect(post?.media).toMatchObject([{ url: "https://pbs.twimg.com/media/pic.jpg?format=jpg&name=orig" }]);
    expect(post?.author).toMatchObject({ screen_name: "other" });
  });

  it("accepts pinned and clear-cache instructions but fails loudly on unknown ones", () => {
    const pinned = {
      data: { user: { result: { rest_id: targetUserId, timeline: { timeline: { instructions: [
        { type: "TimelineClearCache" },
        { type: "TimelinePinEntry", entry: entry({ rest_id: "100", legacy: { full_text: "Pinned" } }, "100") },
      ] } } } } },
    };
    const pinnedResult = parseProfileTimeline(pinned, "2026-11-15T00:00:00Z");
    expect(pinnedResult.valid).toBe(true);
    if (pinnedResult.valid) expect(pinnedResult.posts.map((post) => post.tweet_id)).toEqual(["100"]);
    const unknown = {
      data: { user: { result: { rest_id: targetUserId, timeline: { timeline: { instructions: [
        { type: "TimelineAddToModule", entries: [] },
      ] } } } } },
    };
    expect(parseProfileTimeline(unknown, "2026-11-15T00:00:00Z").valid).toBe(false);
  });

  it("captures media inside quoted posts", () => {
    const data = profilePage([entry({
      rest_id: "100",
      legacy: { full_text: "quote wrapper" },
      quoted_status_result: { result: {
        rest_id: "200",
        legacy: {
          full_text: "quoted with picture",
          extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/quoted.jpg" }] },
        },
        core: { user_results: { result: { core: { screen_name: "quoter", name: "Quoter" } } } },
      } },
    }, "100")]);
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(true);
    const post = result.valid ? result.posts[0] : undefined;
    expect(post?.quoted_tweet).toMatchObject({
      tweet_id: "200",
      media: [{ url: "https://pbs.twimg.com/media/quoted.jpg?format=jpg&name=orig" }],
    });
  });
});

describe("profile media planning", () => {
  it("plans photos at original size, best-bitrate videos, and quoted media", () => {
    const plan = collectMediaJobs([{
      tweet_id: "100",
      status: "available",
      media: [
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig" },
        { type: "video", url: "https://video.twimg.com/ext.mp4", variants: [
          { bitrate: 600_000, content_type: "video/mp4", url: "https://video.twimg.com/ext_small.mp4" },
          { bitrate: 2_500_000, content_type: "video/mp4", url: "https://video.twimg.com/ext_big.mp4" },
          { bitrate: 1_000_000, content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext.m3u8" },
        ] },
      ],
      quoted_tweet: { status: "available", tweet_id: "200", media: [
        { type: "photo", url: "https://pbs.twimg.com/media/q.png" },
      ] },
    }, {
      tweet_id: "101",
      status: "unavailable",
      media: [{ type: "photo", url: "https://pbs.twimg.com/media/hidden.jpg" }],
    }]);
    expect(plan.jobs.map((job) => job.filename)).toEqual(["100_0.jpg", "100_1.mp4", "100_quoted_0.png"]);
    expect(plan.jobs.find((job) => job.filename === "100_1.mp4")?.url).toBe("https://video.twimg.com/ext_big.mp4");
    expect(plan.missing).toBe(0);
  });

  it("counts media without usable URLs as missing", () => {
    const plan = collectMediaJobs([{ tweet_id: "100", status: "available", media: [{ type: "photo" }] }]);
    expect(plan.jobs).toEqual([]);
    expect(plan.missing).toBe(1);
  });

  it("names the export folder after the handle when known", () => {
    expect(exportFolderName("Some One!", "44196397", new Date("2026-11-15T00:00:00Z")))
      .toBe("SomeOne-2026-11-15");
    expect(exportFolderName("token___garden", "44196397", new Date("2026-11-15T00:00:00Z")))
      .toBe("token___garden-2026-11-15");
    expect(exportFolderName(null, "44196397", new Date("2026-11-15T00:00:00Z")))
      .toBe("x-profile-44196397-2026-11-15");
  });
});

describe("profile archive", () => {
  it("collects a two-page profile timeline end to end and exports a cumulative archive", async () => {
    stubChrome();
    seedProfileTarget();
    credentials();
    const db = await openTestProfileArchive(),
      fetchImpl = timelineFetch([
        profilePage([entry({ rest_id: "100", legacy: { full_text: "First" } }, "100"), cursor("page-2")]),
        profilePage([entry({ rest_id: "101", legacy: { full_text: "Second" } }, "101")]),
      ]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const state = await collectProfile({
        userId,
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state.posts).toBe("complete");
      expect(state.reason).toBe("complete");
      expect(state.profile).toMatchObject({ screen_name: "someone", followers_count: 42 });

      const archive = await assembleProfileArchive(db, userId, targetUserId);
      expect(archive.posts.map((post) => post.full_text)).toEqual(["Second", "First"]);
      expect(archive.posts[0]).not.toHaveProperty("folder_ids");
      expect(archive.posts[0]).not.toHaveProperty("target_user_id");
      expect(archive.export_metadata).toMatchObject({
        tool: "x-profile-posts",
        schema_version: 1,
        kind: "cumulative",
        user_id: userId,
        collection: { posts: "complete", operation: "UserTweetsAndReplies" },
        stats: { total_posts: 2, available_posts: 2, media_items: 0 },
      });
      const list = await listProfileStates(db);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ targetUserId, postCount: 2 });
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  }, 10_000);

  it("falls back to the Posts tab capture and records that replies may be missing", async () => {
    stubChrome();
    seedProfileTarget();
    credentials("UserTweets");
    const db = await openTestProfileArchive(),
      fetchImpl = timelineFetch([
        profilePage([entry({ rest_id: "100", legacy: { full_text: "Post" } }, "100")]),
      ]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const state = await collectProfile({
        userId,
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state.posts).toBe("complete");
      expect(state.reason).toBe("complete_without_replies");
      expect(state.operation).toBe("UserTweets");
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  }, 10_000);

  it("resolves a requested screen name through the captured user lookup", async () => {
    stubChrome();
    stored["x_bookmarks_credentials_" + userId] = {
      authorization: "Bearer token",
      queryIds: { UserTweetsAndReplies: "q-profile", UserByScreenName: "q-lookup" },
      features: { UserTweetsAndReplies: "{}" },
    };
    const requests: string[] = [];
    const lookupResponse = { data: { user: { result: { rest_id: targetUserId } } } };
    const gardenPage = profilePage([entry({ rest_id: "100", legacy: { full_text: "Hi" } }, "100")]);
    (gardenPage.data.user.result.core as { screen_name: string }).screen_name = "token___garden";
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: string) => {
      requests.push(String(url));
      return new Response(JSON.stringify(requests.length === 1 ? lookupResponse : gardenPage), { status: 200 });
    }) as typeof fetch;
    const db = await openTestProfileArchive();
    try {
      const state = await collectProfile({
        userId,
        db,
        signal: new AbortController().signal,
        report: () => {},
      }, { screenName: "token___garden" });
      expect(state.posts).toBe("complete");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toContain("UserByScreenName");
      expect(requests[0]).toContain(encodeURIComponent("token___garden"));
      expect(requests[1]).toContain("UserTweetsAndReplies");
      expect(stored["x_profile_target_" + userId]).toMatchObject({
        targetUserId,
        screenName: "token___garden",
      });
    } finally {
      db.close();
    }
  }, 10_000);

  it("fails loudly when the lookup for the requested profile was never captured", async () => {
    stubChrome();
    credentials();
    const db = await openTestProfileArchive();
    try {
      await expect(
        collectProfile({ userId, db, signal: new AbortController().signal, report: () => {} },
          { screenName: "token___garden" }),
      ).rejects.toMatchObject({ _tag: "RequestFailure", kind: "query" });
    } finally {
      db.close();
    }
  });

  it("scans both renamed operations when originals and replies are captured", async () => {
    stubChrome();
    seedProfileTarget();
    stored["x_bookmarks_credentials_" + userId] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-originals", UserRepliesTimeline: "q-replies" },
      features: { UserOriginalsTimeline: "{}", UserRepliesTimeline: "{}" },
    };
    const db = await openTestProfileArchive(),
      originalFetch = globalThis.fetch,
      fetchImpl = timelineFetch([
        profilePage([entry({ rest_id: "100", legacy: { full_text: "Original post" } }, "100")]),
        profilePage([entry({ rest_id: "900", legacy: { full_text: "Reply post" } }, "900")]),
      ]),
      requested: string[] = [];
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: string) => {
      requested.push(String(url));
      return fetchImpl(url);
    }) as typeof fetch;
    try {
      const state = await collectProfile({
        userId,
        db,
        signal: new AbortController().signal,
        report: () => {},
      });
      expect(state.posts).toBe("complete");
      expect(state.reason).toBe("complete");
      expect(state.operation).toBe("UserOriginalsTimeline");
      expect(requested.map((url) => url).join("\n")).toContain("UserOriginalsTimeline");
      expect(requested.map((url) => url).join("\n")).toContain("UserRepliesTimeline");
      const archive = await assembleProfileArchive(db, userId, targetUserId);
      expect(archive.posts.map((post) => post.full_text).sort())
        .toEqual(["Original post", "Reply post"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  }, 10_000);

  it("keeps originals when the replies scan fails, and names the failing operation", async () => {
    stubChrome();
    seedProfileTarget();
    stored["x_bookmarks_credentials_" + userId] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-originals", UserRepliesTimeline: "q-replies" },
      features: { UserOriginalsTimeline: "{}", UserRepliesTimeline: "{}" },
    };
    const db = await openTestProfileArchive(),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: URL) => {
      const target = String(url);
      if (target.includes("UserOriginalsTimeline")) {
        return new Response(JSON.stringify(profilePage([entry({ rest_id: "100", legacy: { full_text: "Kept post" } }, "100")])), { status: 200 });
      }
      return new Response("gone", { status: 404 });
    }) as typeof fetch;
    try {
      await expect(
        collectProfile({ userId, db, signal: new AbortController().signal, report: () => {} }),
      ).rejects.toThrow(/Scan of UserRepliesTimeline failed/u);
      const archive = await assembleProfileArchive(db, userId, targetUserId);
      expect(archive.posts.map((post) => post.full_text)).toEqual(["Kept post"]);
      expect((archive.export_metadata as { collection: unknown }).collection).toMatchObject({ posts: "partial" });
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  }, 10_000);

  it("fails loudly when no profile has been captured", async () => {
    stubChrome();
    credentials();
    const db = await openTestProfileArchive();
    try {
      await expect(
        collectProfile({ userId, db, signal: new AbortController().signal, report: () => {} }),
      ).rejects.toMatchObject({ _tag: "RequestFailure", kind: "query" });
    } finally {
      db.close();
    }
  });

  it("keeps the richer record when X returns a tombstone on re-scan", async () => {
    stubChrome();
    seedProfileTarget();
    credentials();
    const db = await openTestProfileArchive(),
      fetchImpl = timelineFetch([
        profilePage([entry({ rest_id: "100", legacy: { full_text: "Kept" } }, "100")]),
        profilePage([entry(null, "100")]),
      ]),
      originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = fetchImpl;
    try {
      const options = { userId, db, signal: new AbortController().signal, report: () => {} };
      await collectProfile(options);
      await collectProfile(options);
      const archive = await assembleProfileArchive(db, userId, targetUserId);
      expect(archive.posts[0]?.full_text).toBe("Kept");
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  }, 10_000);

  it("preserves earlier content across merges of repost tombstones", () => {
    const available: Bookmark = {
      tweet_id: "900", sort_index: "1", status: "available",
      full_text: "Reposted content", folder_ids: [], observed_at: "2026-11-15T00:00:00Z",
    };
    const tombstone: Bookmark = {
      tweet_id: "900", sort_index: "2", status: "unavailable",
      unavailable_reason: "Reposted post is unavailable.", folder_ids: [], observed_at: "2026-11-15T01:00:00Z",
    };
    const first = mergeProfilePost(undefined, available, targetUserId);
    const second = mergeProfilePost(first, tombstone, targetUserId);
    expect(second.status).toBe("available");
    expect(second.full_text).toBe("Reposted content");
    expect(second.target_user_id).toBe(targetUserId);
  });
});

describe("media downloads", () => {
  function stubDownloads() {
    const listeners: Array<(delta: { id: number; state?: { current: string }; error?: { current: string } }) => void> = [];
    const started = new Map<number, { url: string; filename: string }>();
    let nextId = 1;
    const chromeObject = {
      downloads: {
        download: async (target: { url: string; filename: string }) => {
          const id = nextId;
          nextId += 1;
          started.set(id, target);
          return id;
        },
        onChanged: {
          addListener: (fn: typeof listeners[number]) => void listeners.push(fn),
          removeListener: (fn: typeof listeners[number]) => {
            const index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          },
        },
      },
    };
    (globalThis as Record<string, unknown>)["chrome"] = chromeObject;
    return { listeners, started };
  }

  const jobs = [
    { tweet_id: "1", index: 0, kind: "photo" as const, url: "https://pbs.twimg.com/1.jpg", filename: "1_0.jpg" },
    { tweet_id: "1", index: 1, kind: "photo" as const, url: "https://pbs.twimg.com/2.jpg", filename: "1_1.jpg" },
  ];

  it("reports completions through the downloads change event", async () => {
    const downloads = stubDownloads();
    const resultPromise = downloadPostsMedia(jobs, "folder", {
      report: () => {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(downloads.started.size).toBe(2));
    for (const id of downloads.started.keys()) {
      for (const listener of downloads.listeners) listener({ id, state: { current: "complete" } });
    }
    const result = await resultPromise;
    expect(result).toMatchObject({ total: 2, downloaded: 2, stopped: false });
    expect(result.failed).toEqual([]);
    for (const startedJob of downloads.started.values()) {
      expect(startedJob.filename).toMatch(/^folder\/media\//u);
    }
  });

  it("collects interrupted downloads as failures without aborting the rest", async () => {
    const downloads = stubDownloads();
    const resultPromise = downloadPostsMedia(jobs, "folder", {
      report: () => {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(downloads.started.size).toBe(2));
    const [firstId, secondId] = [...downloads.started.keys()];
    if (firstId === undefined || secondId === undefined) throw new Error("expected two downloads");
    for (const listener of downloads.listeners) listener({ id: firstId, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
    for (const listener of downloads.listeners) listener({ id: secondId, state: { current: "complete" } });
    const result = await resultPromise;
    expect(result.downloaded).toBe(1);
    expect(result.failed).toEqual([{ filename: "1_0.jpg", error: "NETWORK_FAILED" }]);
  });

  it("fails pending downloads after the timeout instead of hanging forever", async () => {
    const downloads = stubDownloads();
    const result = await downloadPostsMedia(jobs, "folder", {
      report: () => {},
      signal: new AbortController().signal,
      timeoutMs: 25,
    });
    expect(downloads.started.size).toBe(2);
    expect(result.downloaded).toBe(0);
    expect(result.failed.map((failure) => failure.error)).toEqual([
      "Timed out waiting for the download to finish.",
      "Timed out waiting for the download to finish.",
    ]);
  });
});
