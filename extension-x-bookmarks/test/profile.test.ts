import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProfile } from "../src/collector.ts";
import { openProfileArchive, assembleProfileArchive, mergeProfilePost, listProfileStates, loadProfileState, profileDbStore, saveProfilePage, saveProfileState } from "../src/profile-storage.ts";
import { readCredentials, currentUserId, readProfileTarget, writeProfileTarget } from "../src/capture.ts";
import { chromeSession } from "../src/api.ts";
import { collectMediaJobs } from "../../x-archive-core/src/media.ts";
import { downloadPostsMedia, exportFolderName, filterAlreadyDownloadedMedia } from "../src/profile-export.ts";
import { parseProfileTimeline } from "../../x-archive-core/src/parser.ts";
import type { Bookmark } from "../../x-archive-core/src/parser.ts";

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

const testDeps = () => ({
  credentials: readCredentials,
  currentUserId,
  readProfileTarget,
  writeProfileTarget,
  session: chromeSession,
});

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
        store: profileDbStore(db),
        deps: testDeps(),
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
        store: profileDbStore(db),
        deps: testDeps(),
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
        store: profileDbStore(db),
        deps: testDeps(),
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
        collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} },
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
        store: profileDbStore(db),
        deps: testDeps(),
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
        collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} }),
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
        collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} }),
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
      const options = { userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} };
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

  it("retries interrupted downloads before reporting them as failed", async () => {
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
    await vi.waitFor(() => expect(downloads.started.size).toBe(3), { timeout: 5000 });
    const [retryId] = [...downloads.started.keys()].filter((id) => id !== firstId && id !== secondId);
    if (retryId === undefined) throw new Error("expected a retried download");
    for (const listener of downloads.listeners) listener({ id: retryId, state: { current: "complete" } });
    const result = await resultPromise;
    expect(result.downloaded).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it("reports a file as failed only after every retry round is exhausted", async () => {
    const downloads = stubDownloads();
    const resultPromise = downloadPostsMedia(jobs, "folder", {
      report: () => {},
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(downloads.started.size).toBe(2));
    const interrupt = async (id: number) => {
      for (const listener of downloads.listeners) listener({ id, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
    };
    const ids = [...downloads.started.keys()];
    const firstId = ids[0];
    const secondId = ids[1];
    if (firstId === undefined || secondId === undefined) throw new Error("expected two downloads");
    await interrupt(firstId);
    for (const listener of downloads.listeners) listener({ id: secondId, state: { current: "complete" } });
    const seen = new Set<number>([firstId, secondId]);
    for (let round = 0; round < 2; round += 1) {
      await vi.waitFor(() => expect(downloads.started.size).toBeGreaterThan(seen.size), { timeout: 5000 });
      const retryId = [...downloads.started.keys()].find((id) => !seen.has(id));
      if (retryId === undefined) throw new Error("expected another retried download");
      seen.add(retryId);
      await interrupt(retryId);
    }
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

describe("profile timeline parse diagnostics", () => {
  it("reports the unsupported instruction instead of a bare failure", () => {
    const data = {
      data: { user: { result: { rest_id: "1", timeline: { timeline: { instructions: [
        { type: "TimelineAddToModule", entries: [] },
      ] } } } } },
    };
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.detail).toContain("TimelineAddToModule");
  });

  it("reports the missing timeline path instead of a bare failure", () => {
    const result = parseProfileTimeline({ data: { user: { result: { __typename: "UserUnavailable" } } } }, "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.detail).toContain("UserUnavailable");
    const empty = parseProfileTimeline({}, "2026-11-15T00:00:00Z");
    if (!empty.valid) expect(empty.detail).toBe("response has no data.user.result");
  });
});

describe("conversation modules in the replies timeline", () => {
  const conversation = (id: string, foreignAuthor: string, ownAuthor: string) => ({
    entryId: "profile-conversation-" + id,
    sortIndex: "9000" + id,
    content: {
      __typename: "TimelineTimelineModule",
      displayType: "VerticalConversation",
      entryType: "TimelineTimelineModule",
      items: [
        { entryId: `profile-conversation-${id}-tweet-7000${id}`, item: { itemContent: {
          __typename: "TimelineTweet",
          tweetDisplayType: "Tweet",
          tweet_results: { result: {
            __typename: "Tweet",
            rest_id: "7000" + id,
            legacy: { full_text: "the parent tweet" },
            core: { user_results: { result: { rest_id: foreignAuthor } } },
          } } } } },
        { entryId: `profile-conversation-${id}-tweet-8000${id}`, item: { itemContent: {
          __typename: "TimelineTweet",
          tweetDisplayType: "Tweet",
          tweet_results: { result: {
            __typename: "Tweet",
            rest_id: "8000" + id,
            legacy: { full_text: "the profile reply", extended_entities: { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/reply.jpg" }] } },
            core: { user_results: { result: { rest_id: ownAuthor } } },
          } } } } },
      ],
    },
  });

  it("keeps only the profile's own replies from conversation modules", () => {
    const data = profilePage([conversation("1", "9999", targetUserId), cursor("next-cursor")]);
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.posts.map((post) => post.tweet_id)).toEqual(["80001"]);
    expect(result.posts[0]?.media).toMatchObject([{ url: "https://pbs.twimg.com/media/reply.jpg?format=jpg&name=orig" }]);
    expect(result.nextCursor).toBe("next-cursor");
  });

  it("fails loudly when a conversation item carries a tweet with no author id", () => {
    const broken = {
      entryId: "profile-conversation-2",
      sortIndex: "90002",
      content: {
        entryType: "TimelineTimelineModule",
        items: [{ entryId: "profile-conversation-2-tweet-70002", item: { itemContent: {
          tweet_results: { result: { __typename: "Tweet", rest_id: "70002", legacy: { full_text: "x" } } } } } }],
      },
    };
    const result = parseProfileTimeline(profilePage([broken]), "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.detail).toContain("author id");
  });

  it("fails loudly when a conversation module is parsed without an author filter", () => {
    const result = parseProfileTimeline(profilePage([conversation("3", "9999", targetUserId)]), "2026-11-15T00:00:00Z");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.detail).toContain("author filter");
  });

  it("skips module items that are not tweets", () => {
    const adOnly = {
      entryId: "profile-conversation-4",
      sortIndex: "90004",
      content: {
        entryType: "TimelineTimelineModule",
        items: [{ entryId: "profile-conversation-4-ad", item: { itemContent: { __typename: "TimelinePromoFormulaItem" } } }],
      },
    };
    const result = parseProfileTimeline(profilePage([adOnly]), "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.posts).toEqual([]);
  });
});

describe("conversation modules with unavailable tweets", () => {
  const moduleWith = (result: unknown, id: string) => ({
    entryId: "profile-conversation-" + id,
    sortIndex: "9000" + id,
    content: {
      entryType: "TimelineTimelineModule",
      items: [{ entryId: `profile-conversation-${id}-tweet-7000${id}`, item: { itemContent: {
        tweet_results: { result },
      } } }],
    },
  });

  it("skips unavailable tweets instead of failing the page", () => {
    const tombstone = moduleWith({ __typename: "TweetTombstone", rest_id: "700011" }, "11");
    const data = profilePage([tombstone, cursor("next-cursor")]);
    const result = parseProfileTimeline(data, "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.posts).toEqual([]);
  });

  it("reads the author from legacy.user_id_str when core metadata is gone", () => {
    const wrapped = moduleWith({
      __typename: "Tweet",
      rest_id: "700012",
      legacy: { full_text: "legacy-only reply", user_id_str: targetUserId },
    }, "12");
    const result = parseProfileTimeline(profilePage([wrapped]), "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.posts.map((post) => post.tweet_id)).toEqual(["700012"]);
  });

  it("reads visibility-wrapped replies on the profile's behalf", () => {
    const visibilityWrapped = moduleWith({
      __typename: "TweetWithVisibilityResults",
      tweet: {
        __typename: "Tweet",
        rest_id: "700013",
        legacy: { full_text: "wrapped reply" },
        core: { user_results: { result: { rest_id: targetUserId } } },
      },
    }, "13");
    const result = parseProfileTimeline(profilePage([visibilityWrapped]), "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.posts.map((post) => post.tweet_id)).toEqual(["700013"]);
  });
});

describe("promoted previews inside conversation modules", () => {
  it("filters out TweetPreviewDisplay promo items by their advertiser id", () => {
    const previewDisplay = {
      entryId: "profile-conversation-2122369301783510976",
      sortIndex: "900050",
      content: {
        entryType: "TimelineTimelineModule",
        items: [
          { entryId: "profile-conversation-2122369301783510976-tweet-2113170725528051867", item: { itemContent: {
            tweet_results: {
              result: {
                __typename: "TweetPreviewDisplay",
                cta: { title: { url: { url: "https://example.com", urlType: "DeepLink" } } },
                tweet: {
                  rest_id: "2113170725528051867",
                  text: "promo text",
                  core: { user_results: { result: { rest_id: "999888777" } } },
                },
              },
            },
          } } },
          { entryId: "profile-conversation-2122369301783510976-tweet-800050", item: { itemContent: {
            tweet_results: { result: {
              __typename: "Tweet",
              rest_id: "800050",
              legacy: { full_text: "the profile reply", user_id_str: targetUserId },
            } },
          } } },
        ],
      },
    };
    const result = parseProfileTimeline(profilePage([previewDisplay]), "2026-11-15T00:00:00Z", targetUserId);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.posts.map((post) => post.tweet_id)).toEqual(["800050"]);
  });
});

describe("profile updates stop early at archived posts", () => {
  it("scans older replies when a newly captured replies page overlaps posts", { timeout: 30_000 }, async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-posts" },
      features: { UserOriginalsTimeline: "{}" },
    };
    seedProfileTarget("UserOriginalsTimeline");
    const db = await openTestProfileArchive();
    const originalFetch = globalThis.fetch;
    const known = entry({ rest_id: "100", legacy: { full_text: "post", user_id_str: targetUserId } }, "100");
    const reply = entry({ rest_id: "90", legacy: { full_text: "older reply", user_id_str: targetUserId, in_reply_to_status_id_str: "80" } }, "90");
    let replyPages = 0;
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: unknown) => {
      const request = new URL(String(url));
      const variables = JSON.parse(request.searchParams.get("variables") ?? "{}") as Record<string, unknown>;
      if (request.pathname.endsWith("UserRepliesTimeline")) {
        replyPages += 1;
        return new Response(JSON.stringify(variables["cursor"] === "older" ? profilePage([reply]) : profilePage([known, cursor("older")])), { status: 200 });
      }
      return new Response(JSON.stringify(profilePage([known])), { status: 200 });
    }) as typeof fetch;
    try {
      const options = { userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} };
      expect((await collectProfile(options)).reason).toBe("complete_without_replies");
      stored["x_bookmarks_credentials_123"] = {
        authorization: "Bearer token",
        queryIds: { UserOriginalsTimeline: "q-posts", UserRepliesTimeline: "q-replies" },
        features: { UserOriginalsTimeline: "{}", UserRepliesTimeline: "{}" },
      };
      expect((await collectProfile(options)).posts).toBe("complete");
      expect(replyPages).toBe(2);
      expect((await assembleProfileArchive(db, userId, targetUserId)).posts.map((post) => post.tweet_id).sort()).toEqual(["100", "90"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("fetches one page and reports up_to_date when the archive is caught up", { timeout: 30_000 }, async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-originals" },
      features: { UserOriginalsTimeline: "{}" },
    };
    stored["x_profile_target_123"] = { targetUserId, operation: "UserOriginalsTimeline", capturedAt: "2026-11-15T00:00:00Z" };
    const db = await openTestProfileArchive();
    const archived = [
      {
        tweet_id: "100", sort_index: "100", status: "available", full_text: "A",
        created_at: "Sun Nov 16 12:00:00 +0000 2026", lang: "en", source: null,
        conversation_id: "100", in_reply_to_tweet_id: null, in_reply_to_user_id: null,
        author: { user_id: targetUserId, screen_name: "someone", name: "Some One", profile_image_url: null, verified: false, followers_count: 42 },
        metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
        entities: { urls: [], hashtags: [], mentions: [] },
        media: [], quoted_tweet: null, card: null, repost_of: undefined, folder_ids: [],
        observed_at: "2026-11-15T00:00:00Z",
      },
      {
        tweet_id: "200", sort_index: "200", status: "available", full_text: "B",
        created_at: "Sun Nov 16 11:00:00 +0000 2026", lang: "en", source: null,
        conversation_id: "200", in_reply_to_tweet_id: null, in_reply_to_user_id: null,
        author: { user_id: targetUserId, screen_name: "someone", name: "Some One", profile_image_url: null, verified: false, followers_count: 42 },
        metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
        entities: { urls: [], hashtags: [], mentions: [] },
        media: [], quoted_tweet: null, card: null, repost_of: undefined, folder_ids: [],
        observed_at: "2026-11-15T00:00:00Z",
      },
    ];
    await saveProfilePage(db, archived as never, targetUserId);
    await saveProfileState(db, targetUserId, {
      started_at: "2026-11-15T00:00:00Z",
      updated_at: "2026-11-15T00:00:00Z",
      posts: "complete",
      reason: "complete",
      operation: "UserOriginalsTimeline",
      completed_operations: ["UserOriginalsTimeline"],
      profile: { user_id: targetUserId, screen_name: "someone", name: "Some One", profile_image_url: null, followers_count: 42, verified: false, description: null },
      cursors: {},
    });
    const page = profilePage([
      entry({ rest_id: "100", legacy: { full_text: "A", user_id_str: targetUserId } }, "100"),
      entry({ rest_id: "200", legacy: { full_text: "B", user_id_str: targetUserId } }, "200"),
      cursor("c1"),
    ]);
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = (async () => {
      fetches += 1;
      return new Response(JSON.stringify(page), { status: 200 });
    }) as typeof fetch;
    try {
      const state = await collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} });
      expect(fetches).toBe(1);
      expect(state.reason).toBe("up_to_date");
      expect(state.posts).toBe("complete");
      const after = await loadProfileState(db, targetUserId);
      expect(after?.cursors?.["UserOriginalsTimeline"]).toBeUndefined();
      expect((await assembleProfileArchive(db, userId, targetUserId)).posts.map((post) => post.tweet_id).sort()).toEqual(["100", "200"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });

  it("keeps paginating when the first page contains a new post", { timeout: 30_000 }, async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-originals" },
      features: { UserOriginalsTimeline: "{}" },
    };
    stored["x_profile_target_123"] = { targetUserId, operation: "UserOriginalsTimeline", capturedAt: "2026-11-15T00:00:00Z" };
    const db = await openTestProfileArchive();
    await saveProfilePage(db, [{
      tweet_id: "100", sort_index: "100", status: "available", full_text: "old",
      created_at: "Sun Nov 16 12:00:00 +0000 2026", lang: "en", source: null,
      conversation_id: "100", in_reply_to_tweet_id: null, in_reply_to_user_id: null,
      author: { user_id: targetUserId, screen_name: "someone", name: "Some One", profile_image_url: null, verified: false, followers_count: 42 },
      metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
      entities: { urls: [], hashtags: [], mentions: [] },
      media: [], quoted_tweet: null, card: null, repost_of: undefined, folder_ids: [],
      observed_at: "2026-11-15T00:00:00Z",
    } as never], targetUserId);
    await saveProfileState(db, targetUserId, {
      started_at: "2026-11-15T00:00:00Z",
      updated_at: "2026-11-15T00:00:00Z",
      posts: "complete",
      reason: "complete",
      operation: "UserOriginalsTimeline",
      completed_operations: ["UserOriginalsTimeline"],
      profile: { user_id: targetUserId, screen_name: "someone", name: "Some One", profile_image_url: null, followers_count: 42, verified: false, description: null },
      cursors: {},
    });
    const pageWithNew = profilePage([
      entry({ rest_id: "999", legacy: { full_text: "new post", user_id_str: targetUserId } }, "999"),
      entry({ rest_id: "100", legacy: { full_text: "old", user_id_str: targetUserId } }, "100"),
      cursor("c1"),
    ]);
    const secondPage = profilePage([entry({ rest_id: "100", legacy: { full_text: "old", user_id_str: targetUserId } }, "100")]);
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: unknown) => {
      const variables = JSON.parse(new URL(String(url)).searchParams.get("variables") ?? "{}") as Record<string, unknown>;
      fetches += 1;
      if (variables["cursor"] === "c1") return new Response(JSON.stringify(secondPage), { status: 200 });
      return new Response(JSON.stringify(pageWithNew), { status: 200 });
    }) as typeof fetch;
    try {
      const state = await collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} });
      expect(fetches).toBe(2);
      expect(state.reason).toBe("up_to_date");
      expect((await assembleProfileArchive(db, userId, targetUserId)).posts.map((post) => post.tweet_id).sort()).toEqual(["100", "999"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });
});

describe("interrupted profile scans resume from the checkpointed cursor", () => {
  it("persists the page cursor and resumes an unfinished operation", { timeout: 30_000 }, async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = {
      authorization: "Bearer token",
      queryIds: { UserOriginalsTimeline: "q-originals" },
      features: { UserOriginalsTimeline: "{}" },
    };
    stored["x_profile_target_123"] = { targetUserId, operation: "UserOriginalsTimeline", capturedAt: "2026-11-15T00:00:00Z" };
    const db = await openTestProfileArchive();
    const originalFetch = globalThis.fetch;
    const pageA = profilePage([entry({ rest_id: "100", legacy: { full_text: "A" } }, "100"), cursor("c1")]);
    const pageB = profilePage([entry({ rest_id: "200", legacy: { full_text: "B" } }, "200"), cursor("c2")]);
    const pageC = profilePage([entry({ rest_id: "300", legacy: { full_text: "C" } }, "300")]);
    const served = (variables: Record<string, unknown>): unknown => {
      if (variables["cursor"] === "c1") return pageB;
      if (variables["cursor"] === "c2") return pageB;
      return pageA;
    };
    (globalThis as Record<string, unknown>)["fetch"] = (async (url: unknown) => {
      const variables = JSON.parse(new URL(String(url)).searchParams.get("variables") ?? "{}") as Record<string, unknown>;
      return new Response(JSON.stringify(served(variables)), { status: 200 });
    }) as typeof fetch;
    try {
      await expect(collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} }))
        .rejects.toThrow(/repeated cursor/u);
      const checkpointed = await loadProfileState(db, targetUserId);
      expect(checkpointed?.cursors).toEqual({ UserOriginalsTimeline: "c2" });
      let resumedCursor: string | null | undefined;
      (globalThis as Record<string, unknown>)["fetch"] = (async (url: unknown) => {
        const variables = JSON.parse(new URL(String(url)).searchParams.get("variables") ?? "{}") as Record<string, unknown>;
        if (resumedCursor === undefined) resumedCursor = (variables["cursor"] as string | null | undefined) ?? null;
        return new Response(JSON.stringify(pageC), { status: 200 });
      }) as typeof fetch;
      const state = await collectProfile({ userId, store: profileDbStore(db), deps: testDeps(), signal: new AbortController().signal, report: () => {} });
      expect(resumedCursor).toBe("c2");
      expect(state.reason).toBe("complete_without_replies");
      const after = await loadProfileState(db, targetUserId);
      expect(after?.cursors?.["UserOriginalsTimeline"]).toBeUndefined();
      const archive = await assembleProfileArchive(db, userId, targetUserId);
      expect(archive.posts.map((post) => post.tweet_id).sort()).toEqual(["100", "200", "300"]);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
      db.close();
    }
  });
});

describe("skipping already downloaded media", () => {
  const jobs = [
    { tweet_id: "1", index: 0, kind: "photo" as const, url: "https://pbs.twimg.com/1.jpg", filename: "1_0.jpg" },
    { tweet_id: "1", index: 1, kind: "photo" as const, url: "https://pbs.twimg.com/2.jpg", filename: "1_1.jpg" },
    { tweet_id: "2", index: 0, kind: "photo" as const, url: "https://pbs.twimg.com/3.jpg", filename: "2_0.jpg" },
  ];

  it("skips jobs whose files completed in this folder and keeps the rest", async () => {
    (globalThis as Record<string, unknown>)["chrome"] = {
      downloads: {
        search: async ({ query, state }: { query: string[]; state: string }) => {
          expect(state).toBe("complete");
          expect(query).toEqual(["bookmarks-2026-11-16/media/"]);
          return [
            { filename: "/Users/josh/Downloads/bookmarks-2026-11-16/media/1_0.jpg" },
            { filename: "/Users/josh/Downloads/bookmarks-2026-11-16/media/2_0.jpg" },
          ];
        },
      },
    };
    try {
      const remaining = await filterAlreadyDownloadedMedia(jobs, "bookmarks-2026-11-16", () => {});
      expect(remaining.map((job) => job.filename)).toEqual(["1_1.jpg"]);
    } finally {
      delete (globalThis as Record<string, unknown>)["chrome"];
    }
  });

  it("downloads everything when the history lookup fails or finds nothing", async () => {
    (globalThis as Record<string, unknown>)["chrome"] = {
      downloads: {
        search: async () => { throw new Error("downloads unavailable"); },
      },
    };
    try {
      const remaining = await filterAlreadyDownloadedMedia(jobs, "bookmarks-2026-11-16", () => {});
      expect(remaining.map((job) => job.filename)).toEqual(["1_0.jpg", "1_1.jpg", "2_0.jpg"]);
    } finally {
      delete (globalThis as Record<string, unknown>)["chrome"];
    }
  });
});
