import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteProfileStore } from "../src/profile-db.ts";

let root: string | null = null;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

function useTempDir(): string {
  root = mkdtempSync(join(tmpdir(), "x-archive-db-test-"));
  return root;
}

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

describe("SqliteProfileStore", () => {
  it("persists records across store instances and merges by tweet_id", async () => {
    const dir = useTempDir();
    const dbPath = join(dir, "archive.db");
    const first = new SqliteProfileStore(dbPath, "1000");
    await first.savePage([post("100", "first") as never, post("200", "other") as never], "1000");
    first.close();

    const second = new SqliteProfileStore(dbPath, "1000");
    await second.savePage([{ ...post("100", "second"), status: "unavailable" } as never], "1000");
    expect(second.count()).toBe(2);
    const records = await second.allRecords() as Array<Record<string, unknown>>;
    const hundred = records.find((record) => record["tweet_id"] === "100")!;
    expect(hundred["status"]).toBe("available");
    expect(hundred["full_text"]).toBe("first");
    second.close();
  });

  it("scopes records per target user id", async () => {
    const dir = useTempDir();
    const dbPath = join(dir, "archive.db");
    const one = new SqliteProfileStore(dbPath, "1000");
    const two = new SqliteProfileStore(dbPath, "2000");
    await one.savePage([post("100", "a") as never], "1000");
    await expect(two.savePage([post("100", "b") as never], "1000")).rejects.toThrow("scope mismatch");
    await two.savePage([post("100", "b") as never], "2000");
    expect(one.count()).toBe(1);
    expect(two.count()).toBe(1);
    one.close();
    two.close();
  });

  it("reports allKnown only when every id is already stored", async () => {
    const dir = useTempDir();
    const store = new SqliteProfileStore(join(dir, "archive.db"), "1000");
    await store.savePage([post("100", "a") as never, post("200", "b") as never], "1000");
    expect(await store.allKnown([post("100", "a") as never, post("200", "b") as never], "1000")).toBe(true);
    expect(await store.allKnown([post("100", "a") as never, post("300", "c") as never], "1000")).toBe(false);
    expect(await store.allKnown([], "1000")).toBe(false);
    store.close();
  });

  it("round-trips scan state including operation and profile", async () => {
    const dir = useTempDir();
    const dbPath = join(dir, "archive.db");
    const first = new SqliteProfileStore(dbPath, "1000");
    const profile = {
      user_id: "1000",
      screen_name: "someone",
      name: "Some One",
      profile_image_url: null,
      followers_count: 42,
      verified: false,
      description: null,
    };
    await first.saveState("1000", {
      started_at: "2026-11-16T00:00:00Z",
      updated_at: "2026-11-16T00:00:00Z",
      posts: "complete",
      reason: "complete",
      operation: "UserOriginalsTimeline",
      profile,
      cursors: {},
    });
    first.close();

    const second = new SqliteProfileStore(dbPath, "1000");
    const state = await second.loadState("1000");
    expect(state?.posts).toBe("complete");
    expect(state?.operation).toBe("UserOriginalsTimeline");
    expect(state?.profile?.screen_name).toBe("someone");
    second.close();
  });

  it("reads a missing state as null", async () => {
    const dir = useTempDir();
    const store = new SqliteProfileStore(join(dir, "archive.db"), "1000");
    expect(await store.loadState("1000")).toBeNull();
    store.close();
  });
});
