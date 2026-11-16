import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBookmarksStore, FsLikesStore, FsProfileStore } from "../src/fs-store.ts";
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

  it("scopes profile archives per target user id", async () => {
    useTempStateRoot();
    const one = new FsProfileStore("123", "1000");
    const two = new FsProfileStore("123", "2000");
    await one.savePage([post("100", "a") as never], "1000");
    await two.savePage([post("100", "b") as never, post("200", "c") as never], "2000");
    expect((await one.allRecords())).toHaveLength(1);
    expect((await two.allRecords())).toHaveLength(2);
  });

  it("reads empty archives as empty, not as an error", async () => {
    useTempStateRoot();
    const store = new FsBookmarksStore("123");
    expect(await store.allRecords()).toEqual([]);
    expect(await store.allFolders()).toEqual([]);
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
