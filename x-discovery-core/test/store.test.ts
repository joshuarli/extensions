import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../lib/test/tmp.ts";
import { newRun } from "../src/observation.ts";
import type { DiscoveredPost } from "../src/post.ts";
import { contentHash, DiscoveryStore } from "../src/store.ts";

let directory: string;
let store: DiscoveryStore;

beforeEach(() => {
  directory = makeTempDir("x-discovery-store-");
  store = new DiscoveryStore(join(directory, "discovery.db"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function post(id: string, favoriteCount = 0): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: "900",
    author_handle: "dave",
    author_name: null,
    created_at: "",
    full_text: "criterion",
    lang: "en",
    urls: [],
    favorite_count: favoriteCount,
    retweet_count: 0,
    relationship: { kind: "original", source_tweet_id: null, source_handle: null },
    observed_at: "2026-11-25T00:00:00.000Z",
  };
}

function commit(runId: string, page: number, cursor: string | null, posts: DiscoveredPost[], accountId = "1725684628491739136") {
  store.commitPage({
    runId,
    accountId,
    feed: "home-for-you",
    page,
    data: { data: { page } },
    posts,
    cursor,
    accounting: { total: posts.length, posts: posts.length, cursors: 1, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 },
  });
}

describe("DiscoveryStore", () => {
  it("commits a page transactionally and is idempotent for retries", () => {
    const run = newRun("1725684628491739136", "home-for-you", 5);
    store.beginRun(run);
    commit(run.runId, 1, "next", [post("1")]);
    commit(run.runId, 1, "next", [post("1")]);
    expect(store.allPosts().map((record) => record.tweet_id)).toEqual(["1"]);
    expect(store.observations(run.runId)).toHaveLength(1);
    expect(store.readCheckpoint(run.runId)).toBe("next");
    expect(store.rawPage(run.runId, 1)).toEqual({ data: { page: 1 } });
    expect(store.accounting(run.runId, 1)).toMatchObject({ posts: 1 });
  });

  it("hashes content without engagement counts or tweet id", () => {
    expect(contentHash(post("1", 3))).toBe(contentHash(post("1", 99)));
    expect(contentHash(post("1"))).toBe(contentHash(post("2")));
    const changed = { ...post("1"), full_text: "a different film" };
    expect(contentHash(changed)).not.toBe(contentHash(post("1")));
  });

  it("allows one job lock per account until released", () => {
    const run = newRun("1725684628491739136", "home-for-you", 5);
    expect(store.acquireJobLock(run.accountId, run.runId)).toBe(true);
    expect(store.acquireJobLock(run.accountId, "another-run")).toBe(false);
    store.releaseJobLock(run.accountId, run.runId);
    expect(store.acquireJobLock(run.accountId, "another-run")).toBe(true);
  });

  it("takes over a stale lease without a human", () => {
    const started = "2026-11-25T00:00:00.000Z";
    const later = "2026-11-25T00:11:00.000Z";
    expect(store.acquireJobLock("900", "dead-run", started)).toBe(true);
    expect(store.acquireJobLock("900", "fresh-run", "2026-11-25T00:05:00.000Z")).toBe(false);
    expect(store.acquireJobLock("900", "fresh-run", later)).toBe(true);
  });

  it("keeps each appearance of a post with its own page and entry identity", () => {
    const run = newRun("1725684628491739136", "home-for-you", 5);
    store.beginRun(run);
    commit(run.runId, 1, "next", [post("100"), post("101")]);
    commit(run.runId, 2, null, [{ ...post("102"), entry_id: "entry-102" }, { ...post("100"), entry_id: "entry-100-again" }]);
    const observations = store.observations(run.runId);
    expect(observations).toHaveLength(4);
    expect(observations.map((entry) => [entry.page, entry.tweetId, entry.entryId])).toEqual([
      [1, "100", "tweet-100"],
      [1, "101", "tweet-101"],
      [2, "102", "entry-102"],
      [2, "100", "entry-100-again"],
    ]);
  });

  it("renews a live lease and refuses writes after a takeover", () => {
    const account = "900";
    const first = newRun(account, "home-for-you", 5);
    expect(store.acquireJobLock(account, first.runId, "2026-11-25T00:00:00.000Z")).toBe(true);
    store.beginRun(first);
    store.renewJobLock(account, first.runId, "2026-11-25T00:09:00.000Z");
    expect(store.acquireJobLock(account, "second", "2026-11-25T00:14:00.000Z")).toBe(false);
    expect(store.acquireJobLock(account, "second", "2026-11-25T00:20:00.000Z")).toBe(true);
    expect(() => commit(first.runId, 1, null, [post("1")], account)).toThrow("taken over");
    expect(() => store.finishRun(first.runId, "budget_reached")).toThrow("taken over");
  });

  it("keeps a failing response and its reason", () => {
    const run = newRun("1725684628491739136", "home-for-you", 5);
    store.beginRun(run);
    store.saveFailure(run.runId, 2, { data: {} }, "shape changed");
    expect(store.failures(run.runId)).toEqual([{ page: 2, detail: "shape changed" }]);
    expect(store.rawPage(run.runId, 2)).toEqual({ data: {} });
  });

  it("caches derivations by input hash and version", () => {
    store.saveDerivation("abc", "topic-1", { score: 4 });
    expect(store.derivation("abc", "topic-1")).toEqual({ score: 4 });
    expect(store.derivation("abc", "topic-2")).toBeNull();
  });

  it("records run start and explicit stop reason", () => {
    const run = newRun("1725684628491739136", "home-following", 2);
    store.beginRun(run);
    store.finishRun(run.runId, "budget_reached");
    expect(store.runs(run.accountId)[0]).toMatchObject({ stopReason: "budget_reached", budgetPages: 2 });
    expect(store.runs(run.accountId)[0]?.endedAt).not.toBeNull();
  });
});
