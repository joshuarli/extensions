import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { BookmarkSchema } from "../../x-archive-core/src/parser.ts";
import { FsBookmarksStore, FsLikesStore } from "../src/fs-store.ts";
import { writeJsonFile, readJsonFile } from "../src/state.ts";

const savedHome = process.env["X_ARCHIVE_STATE"];
let root: string | null = null;

function useTempStateRoot(): string {
  root = mkdtempSync(join(tmpdir(), "x-archive-test-"));
  process.env["X_ARCHIVE_STATE"] = root;
  return root;
}

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
  if (savedHome === undefined) delete process.env["X_ARCHIVE_STATE"];
  else process.env["X_ARCHIVE_STATE"] = savedHome;
});

const post = (id: string, full_text: string, status = "available") => ({
  tweet_id: id,
  sort_index: id,
  status,
  created_at: "Sun Nov 16 12:00:00 +0000 2026",
  full_text,
  lang: "en",
  source: null,
  conversation_id: id,
  in_reply_to_tweet_id: null,
  in_reply_to_user_id: null,
  author: { user_id: "1", screen_name: "someone", name: "Some One", profile_image_url: null, verified: false, followers_count: 1 },
  metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
  entities: { urls: [], hashtags: [], mentions: [] },
  media: [],
  quoted_tweet: null,
  card: null,
  folder_ids: [],
  observed_at: "2026-11-16T00:00:00.000Z",
});

describe("filesystem archive stores", () => {
  it("saves pages, merges by tweet_id, and keeps available over a later unavailable page", async () => {
    useTempStateRoot();
    const store = new FsBookmarksStore("123");
    await store.savePage([post("100", "first") as never]);
    await store.savePage([{ ...post("100", "second"), status: "unavailable" } as never]);
    const all = await store.allRecords();
    expect(all).toHaveLength(1);
    expect((all[0] as Record<string, unknown>)["status"]).toBe("available");
    expect((all[0] as Record<string, unknown>)["full_text"]).toBe("first");
  });

  it("round-trips scan state with cursors", async () => {
    useTempStateRoot();
    const store = new FsLikesStore("123");
    expect(await store.loadState()).toBeNull();
    await store.saveState({ started_at: "2026-11-16T00:00:00Z", updated_at: "2026-11-16T00:00:00Z", likes: "partial", reason: "in_progress", cursors: { Likes: "abc123" } });
    const state = await store.loadState();
    expect(state?.cursors).toEqual({ Likes: "abc123" });
    expect(state?.likes).toBe("partial");
  });

  it("reads empty archives as empty, not as an error", async () => {
    useTempStateRoot();
    const store = new FsBookmarksStore("123");
    expect(await store.allRecords()).toEqual([]);
    expect(await store.allFolders()).toEqual([]);
  });

  it("merges folders and preserves corrupt folder files", async () => {
    const dir = useTempStateRoot();
    const store = new FsBookmarksStore("123");
    await store.saveFolders([{ id: "one", name: "caf\u00e9" }, { id: "keep", name: "untouched" }]);
    expect(await store.allFolders()).toEqual([
      { id: "one", name: "caf\u00e9" }, { id: "keep", name: "untouched" },
    ]);
    await store.saveFolders([{ id: "two", name: "second" }, { id: "one", name: "renamed" }]);
    expect(await store.allFolders()).toEqual([
      { id: "one", name: "renamed" }, { id: "keep", name: "untouched" }, { id: "two", name: "second" },
    ]);
    const path = join(dir, "x-archive", "stores", "123", "folders.json");
    writeFileSync(path, "{broken");
    await expect(store.allFolders()).rejects.toThrow();
    await expect(store.saveFolders([{ id: "three", name: "third" }])).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe("{broken");
  });
});

describe.each([
  ["bookmarks", FsBookmarksStore],
  ["likes", FsLikesStore],
] as const)("%s archive safety", (kind, Store) => {
  it("initializes missing profiles, merges Unicode records with a BOM, and isolates accounts", async () => {
    const dir = useTempStateRoot();
    const first = new Store("123");
    const second = new Store("456");
    const old = Schema.decodeUnknownSync(BookmarkSchema)(post("100", "caf\u00e9"));
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await first.savePage([old]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(path)]));
    await first.savePage([incoming]);
    expect(await first.allRecords()).toEqual([old, incoming]);
    expect(await second.allRecords()).toEqual([]);
    await second.savePage([incoming]);
    expect(await first.allRecords()).toEqual([old, incoming]);
    expect(await second.allRecords()).toEqual([incoming]);
  });

  it.each([
    ["malformed JSON", "[{\"tweet_id\":\"old\""],
    ["non-array JSON", "{\"tweet_id\":\"old\"}\n"],
  ])("rejects a save over %s and preserves its bytes", async (_description, bytes) => {
    const dir = useTempStateRoot();
    const store = new Store("123");
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await store.savePage([Schema.decodeUnknownSync(BookmarkSchema)(post("100", "old"))]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    writeFileSync(path, bytes);

    const results = await Promise.allSettled([store.allRecords(), store.savePage([incoming])]);
    for (const result of results) {
      expect.soft(result.status).toBe("rejected");
      if (result.status === "rejected") {
        const failure: unknown = result.reason;
        expect(failure).toBeInstanceOf(Error);
        if (failure instanceof Error) {
          expect(failure.message).toContain(path);
          if (_description === "malformed JSON") expect(failure.cause).toBeInstanceOf(SyntaxError);
          else expect(failure).toBeInstanceOf(TypeError);
        }
      }
    }
    expect.soft(readFileSync(path, "utf8")).toBe(bytes);
  });

  it("rejects a save when the existing archive cannot be read and preserves its bytes", async () => {
    const dir = useTempStateRoot();
    const store = new Store("123");
    const old = Schema.decodeUnknownSync(BookmarkSchema)(post("100", "old"));
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await store.savePage([old]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    const bytes = readFileSync(path);
    chmodSync(path, 0o200);
    try {
      expect(() => readFileSync(path)).toThrow(expect.objectContaining({ code: "EACCES" }));
      const result = await Promise.allSettled([store.savePage([incoming])]);
      expect.soft(result[0]?.status).toBe("rejected");
      if (result[0]?.status === "rejected") {
        const failure: unknown = result[0].reason;
        expect(failure).toMatchObject({ code: "EACCES", path });
      }
    } finally {
      chmodSync(path, 0o600);
    }
    expect(readFileSync(path)).toEqual(bytes);
  });

  it("rejects invalid UTF-8 without rewriting existing record bytes", async () => {
    const dir = useTempStateRoot();
    const store = new Store("123");
    const old = Schema.decodeUnknownSync(BookmarkSchema)(post("100", "old"));
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await store.savePage([old]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    const bytes = Buffer.from(JSON.stringify([{ ...old, full_text: "\u00ff" }]), "latin1");
    writeFileSync(path, bytes);
    const results = await Promise.allSettled([store.allRecords(), store.savePage([incoming])]);
    for (const result of results) {
      expect.soft(result.status).toBe("rejected");
      if (result.status === "rejected") {
        const failure: unknown = result.reason;
        expect(failure).toBeInstanceOf(Error);
        if (failure instanceof Error) {
          expect(failure.message).toContain(path);
          expect(failure.cause).toBeInstanceOf(TypeError);
        }
      }
    }
    expect.soft(readFileSync(path)).toEqual(bytes);
  });
});

describe("state file helpers", () => {
  it("round-trips state and treats missing or malformed optional JSON as absent", () => {
    const dir = useTempStateRoot();
    const path = join(dir, "sample.json");
    expect(readJsonFile(path)).toBeNull();
    writeJsonFile(path, { a: 1 });
    expect(readJsonFile(path)).toEqual({ a: 1 });
    writeJsonFile(path, { a: 2 });
    expect(readJsonFile(path)).toEqual({ a: 2 });
    writeFileSync(path, "{");
    expect(readJsonFile(path)).toBeNull();
    expect(readFileSync(path, "utf8")).toBe("{");
  });
});

describe.each([["bookmarks", FsBookmarksStore], ["likes", FsLikesStore]] as const)("%s persistence boundaries", (kind, Store) => {
  it("leaves missing and corrupt archives untouched on empty pages", async () => {
    const dir = useTempStateRoot();
    const store = new Store("123");
    await store.savePage([]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    expect(() => readFileSync(path)).toThrow(expect.objectContaining({ code: "ENOENT" }));
    writeJsonFile(path, ["old"]);
    writeFileSync(path, "{broken");
    await store.savePage([]);
    expect(readFileSync(path, "utf8")).toBe("{broken");
  });

  it("rejects a failed replacement without changing the existing archive", async () => {
    const dir = useTempStateRoot();
    const store = new Store("123");
    const old = Schema.decodeUnknownSync(BookmarkSchema)(post("100", "old"));
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await store.savePage([old]);
    const path = join(dir, "x-archive", "stores", "123", `${kind}.json`);
    const bytes = readFileSync(path);
    // A directory at the staging path causes a real filesystem write failure.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path + ".tmp");
    await expect(store.savePage([incoming])).rejects.toMatchObject({ code: "EISDIR" });
    expect(readFileSync(path)).toEqual(bytes);
  });
});

it("filters folder records without string ids before merging", async () => {
  const dir = useTempStateRoot();
  const path = join(dir, "x-archive", "stores", "123", "folders.json");
  writeJsonFile(path, [{ id: 42, name: "discard" }, { name: "missing" }, { id: "keep", name: "old" }]);
  const store = new FsBookmarksStore("123");
  await store.saveFolders([{ id: "new", name: "added" }]);
  expect(await store.allFolders()).toEqual([{ id: "keep", name: "old" }, { id: "new", name: "added" }]);
});

it("validates and isolates bookmark and likes scan state", async () => {
  const dir = useTempStateRoot();
  const bookmarks = new FsBookmarksStore("123");
  const likes = new FsLikesStore("123");
  const other = new FsBookmarksStore("456");
  const state = { started_at: "start", updated_at: "update", bookmarks: "partial" as const, folders: "complete" as const, reason: "resume", cursors: { Bookmarks: "next" } };
  await bookmarks.saveState(state);
  expect(await bookmarks.loadState()).toEqual(state);
  expect(await other.loadState()).toBeNull();
  expect(await likes.loadState()).toBeNull();
  const path = join(dir, "x-archive", "state", "123", "bookmarks-state.json");
  const bytes = readFileSync(path);
  await expect(bookmarks.saveState({ ...state, bookmarks: "invalid" } as never)).rejects.toThrow();
  expect(readFileSync(path)).toEqual(bytes);
  writeFileSync(path, JSON.stringify({ ...state, bookmarks: "invalid" }));
  expect(await bookmarks.loadState()).toBeNull();
  const likesPath = join(dir, "x-archive", "state", "123", "likes-state.json");
  const likesState = { started_at: "start", updated_at: "update", likes: "partial" as const, reason: "resume", cursors: { Likes: "next" } };
  await likes.saveState(likesState);
  expect(await likes.loadState()).toEqual(likesState);
  const likesBytes = readFileSync(likesPath);
  await expect(likes.saveState({ ...likesState, likes: "invalid" } as never)).rejects.toThrow();
  expect(readFileSync(likesPath)).toEqual(likesBytes);
  writeFileSync(likesPath, '{"likes":"invalid"}');
  expect(await likes.loadState()).toBeNull();
});

it("does not advance a collector checkpoint when the filesystem page save fails", async () => {
  const { collectTimeline } = await import("../../x-archive-core/src/collector.ts");
  const dir = useTempStateRoot();
  const store = new FsBookmarksStore("123");
  const path = join(dir, "x-archive", "stores", "123", "bookmarks.json");
  writeJsonFile(path, []);
  writeFileSync(path, "{broken");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [
    { entryId: "tweet-1", sortIndex: "999", content: { itemContent: { tweet_results: { result: { rest_id: "1", legacy: { full_text: "First" } } } } } },
    { entryId: "cursor-bottom-0", content: { value: "next" } },
  ] }] } } } }), { status: 200 });
  const checkpoints: unknown[] = [];
  try {
    await expect(collectTimeline({
      userId: "123", store, signal: new AbortController().signal, report: () => {},
      checkpoint: async (key, cursor) => { checkpoints.push([key, cursor]); },
      deps: {
        credentials: async () => ({ authorization: "test", queryIds: { Bookmarks: "test" }, features: {} }),
        currentUserId: async () => "123", readProfileTarget: async () => null,
        writeProfileTarget: async () => {}, session: async () => ({ userId: "123", csrfToken: "test" }),
      },
    }, "Bookmarks")).rejects.toThrow(`Cannot parse archive ${path}`);
    expect(checkpoints).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe("{broken");
  } finally { globalThis.fetch = originalFetch; }
});
