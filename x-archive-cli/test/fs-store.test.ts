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
});

describe.each([
  ["bookmarks", FsBookmarksStore],
  ["likes", FsLikesStore],
] as const)("%s archive safety", (kind, Store) => {
  it("initializes a missing profile, merges valid records, and isolates accounts", async () => {
    useTempStateRoot();
    const first = new Store("123");
    const second = new Store("456");
    const old = Schema.decodeUnknownSync(BookmarkSchema)(post("100", "old"));
    const incoming = Schema.decodeUnknownSync(BookmarkSchema)(post("200", "new"));
    await first.savePage([old]);
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

    const result = await Promise.allSettled([store.savePage([incoming])]);
    expect.soft(result[0]?.status).toBe("rejected");
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
    } finally {
      chmodSync(path, 0o600);
    }
    expect(readFileSync(path)).toEqual(bytes);
  });
});

describe("state file helpers", () => {
  it("writes JSON with a temp file and keeps the previous content on failure", async () => {
    const dir = useTempStateRoot();
    const path = join(dir, "sample.json");
    writeJsonFile(path, { a: 1 });
    expect(readJsonFile(path)).toEqual({ a: 1 });
    writeJsonFile(path, { a: 2 });
    expect(readJsonFile(path)).toEqual({ a: 2 });
  });
});
