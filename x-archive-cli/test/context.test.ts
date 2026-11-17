import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { SqliteProfileStore } from "../src/profile-db.ts";
import { syncContextThreads } from "../src/context.ts";
import type { Bookmark } from "../../x-archive-core/src/parser.ts";

let root: string | null = null;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

function useTempDir(): string {
  root = mkdtempSync(join(tmpdir(), "x-archive-context-test-"));
  return root;
}

const fixtureHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "conversation-page.html"), "utf8");

const post = (id: string, full_text: string, parent: string | null, conversationId: string): Bookmark => ({
  tweet_id: id,
  sort_index: id,
  status: "available",
  created_at: "Sun Nov 16 12:00:00 +0000 2026",
  full_text,
  lang: "en",
  source: null,
  conversation_id: conversationId,
  in_reply_to_tweet_id: parent,
  in_reply_to_user_id: parent ? "1" : null,
  author: { user_id: "1000", screen_name: "someone", name: "Some One", profile_image_url: null, verified: false, followers_count: 1 },
  metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
  entities: { urls: [], hashtags: [], mentions: [] },
  media: [],
  quoted_tweet: null,
  card: null,
  folder_ids: [],
  observed_at: "2026-11-16T00:00:00.000Z",
});

const CONVERSATION = "2121990160426381595";

describe("syncContextThreads", () => {
  it("backfills the ancestor chain from one page and resumes without refetching", async () => {
    const dir = useTempDir();
    const store = new SqliteProfileStore(join(dir, "archive.db"), "1000");
    await store.savePage(
      [post("2121991008691130620", "our reply", "2121990345332576733", CONVERSATION)],
      "1000",
    );

    const fetches: string[] = [];
    const result = await syncContextThreads({
      store,
      targetUserId: "1000",
      signal: new AbortController().signal,
      report: () => {},
      fetchHtml: async (focalId: string) => {
        fetches.push(focalId);
        return fixtureHtml;
      },
      pageDelayMs: 0,
    });
    expect(fetches).toEqual(["2121991008691130620"]);
    expect(result.stored).toBe(2);
    expect(result.failed).toBe(0);
    expect(await store.contextCount()).toBe(2);

    const again = await syncContextThreads({
      store,
      targetUserId: "1000",
      signal: new AbortController().signal,
      report: () => {},
      fetchHtml: async () => {
        throw new Error("must not fetch");
      },
      pageDelayMs: 0,
    });
    expect(again).toEqual({ fetched: 0, stored: 0, failed: 0, unreachable: 0 });
    store.close();
  });

  it("recovers when killed before the first ancestor save", async () => {
    const dbPath = join(useTempDir(), "archive.db");
    const store = new SqliteProfileStore(dbPath, "1000");
    await store.savePage([post("2121991008691130620", "our reply", "2121990345332576733", CONVERSATION)], "1000");
    store.close();
    const child = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "fixtures", "context-crash-child.ts"), dbPath], { timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBe("SIGKILL");
    const reopened = new SqliteProfileStore(dbPath, "1000");
    expect(await reopened.contextCount()).toBe(0);
    const result = await syncContextThreads({ store: reopened, targetUserId: "1000", signal: new AbortController().signal,
      report: () => {}, fetchHtml: async () => fixtureHtml, pageDelayMs: 0 });
    expect(result.stored).toBe(2);
    expect(await reopened.contextCount()).toBe(2);
    expect((await reopened.allRecords()).length).toBe(1);
    reopened.close();
  });

  it("resumes from an ancestor committed before a crash", async () => {
    const dbPath = join(useTempDir(), "archive.db");
    const initial = new SqliteProfileStore(dbPath, "1000");
    await initial.savePage([post("2121991008691130620", "our reply", "2121990345332576733", CONVERSATION)], "1000");
    initial.close();
    const child = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "fixtures", "context-crash-child.ts"), dbPath, "2"], { timeout: 10000 });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBe("SIGKILL");
    const store = new SqliteProfileStore(dbPath, "1000");
    expect(await store.contextCount()).toBe(1);
    await syncContextThreads({ store, targetUserId: "1000", signal: new AbortController().signal,
      report: () => {}, fetchHtml: async () => fixtureHtml, pageDelayMs: 0 });
    expect(await store.contextCount()).toBe(2);
    store.close();
  });

  it("caches a genuine legacy gap after one retry", async () => {
    const dbPath = join(useTempDir(), "archive.db");
    let store = new SqliteProfileStore(dbPath, "1000");
    await store.savePage([post("1", "our reply", "2", CONVERSATION)], "1000");
    store.close();
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO context_pages (target_user_id, focal_id, status, fetched_at, attempts) VALUES ('1000', ?, 'ok', 'old', 0)").run("1");
    db.close();
    store = new SqliteProfileStore(dbPath, "1000");
    let calls = 0;
    const options = { store, targetUserId: "1000", signal: new AbortController().signal, report: () => {},
      fetchHtml: async () => { calls++; return fixtureHtml; }, pageDelayMs: 0 };
    await syncContextThreads(options);
    await syncContextThreads(options);
    expect(calls).toBe(1);
    store.close();
  });

  it("repairs a legacy false ok when ancestors are available", async () => {
    const dbPath = join(useTempDir(), "archive.db");
    const initial = new SqliteProfileStore(dbPath, "1000");
    await initial.savePage([post("2121991008691130620", "our reply", "2121990345332576733", CONVERSATION)], "1000");
    initial.close();
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO context_pages (target_user_id, focal_id, status, fetched_at, attempts) VALUES ('1000', ?, 'ok', 'old', 0)").run("2121991008691130620");
    db.close();
    const store = new SqliteProfileStore(dbPath, "1000");
    const result = await syncContextThreads({ store, targetUserId: "1000", signal: new AbortController().signal,
      report: () => {}, fetchHtml: async () => fixtureHtml, pageDelayMs: 0 });
    expect(result.stored).toBe(2);
    expect(await store.contextCount()).toBe(2);
    store.close();
  });

  it("preserves the failed attempt budget across restarts", async () => {
    const dbPath = join(useTempDir(), "archive.db");
    let store = new SqliteProfileStore(dbPath, "1000");
    await store.savePage([post("1", "reply", "2", CONVERSATION)], "1000");
    for (let i = 0; i < 6; i++) await store.markContextPage("1", "failed");
    store.close();
    store = new SqliteProfileStore(dbPath, "1000");
    let calls = 0;
    const result = await syncContextThreads({ store, targetUserId: "1000", signal: new AbortController().signal,
      report: () => {}, fetchHtml: async () => { calls++; return fixtureHtml; }, pageDelayMs: 0 });
    expect(calls).toBe(0);
    expect(result.unreachable).toBe(1);
    expect(await store.contextPageAttempts("1")).toBe(6);
    store.close();
  });

  it("records failed pages and reports them without touching the own archive", async () => {
    const dir = useTempDir();
    const store = new SqliteProfileStore(join(dir, "archive.db"), "1000");
    await store.savePage(
      [post("2121991008691130620", "our reply", "2121990345332576733", CONVERSATION)],
      "1000",
    );
    const result = await syncContextThreads({
      store,
      targetUserId: "1000",
      signal: new AbortController().signal,
      report: () => {},
      fetchHtml: async () => {
        throw new Error("HTTP 429");
      },
      pageDelayMs: 0,
      backoffMs: () => 0,
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.stored).toBe(0);
    expect((await store.allRecords()).length).toBe(1);
    expect(await store.contextCount()).toBe(0);
    store.close();
  });
});
