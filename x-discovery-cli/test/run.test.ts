import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DiscoveryStore,
  loadProject,
  newRun,
  readLedger,
  type DiscoveredPost,
} from "../../x-discovery-core/src/index.ts";
import { buildReport, deriveFindings, trackFinds } from "../src/run.ts";

let directory: string;
let store: DiscoveryStore;

function post(id: string, text: string, handle: string, authorId: string): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: authorId,
    author_handle: handle,
    author_name: null,
    created_at: "",
    full_text: text,
    lang: "en",
    urls: id === "1" ? [{ url: "https://mega.nz/file/one", display_url: "mega.nz" }] : [],
    favorite_count: 0,
    retweet_count: 0,
    relationship: { kind: "original", source_tweet_id: null, source_handle: null },
    observed_at: "2026-11-25T00:00:00.000Z",
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(process.cwd(), ".work/tmp", "x-discovery-cli-"));
  store = new DiscoveryStore(join(directory, "discovery.db"));
  const run = newRun("1725684628491739136", "home-for-you", 5);
  store.beginRun(run);
  store.commitPage({
    runId: run.runId,
    accountId: run.accountId,
    feed: run.feed,
    page: 1,
    data: { data: {} },
    posts: [post("1", "Criterion and MUBI tonight", "dave", "900")],
    cursor: null,
    accounting: { total: 1, posts: 1, cursors: 0, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 },
  });
  store.close();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("deriveFindings", () => {
  it("writes topics, links and an explainable ranked account file", async () => {
    const summary = await deriveFindings({ outDir: directory, project: loadProject("movies") });
    expect(summary).toMatchObject({ posts: 1, topics: 1, links: 1, accounts: 1, cached: false });
    const accounts = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(accounts[0]).toMatchObject({ handle: "dave", relevant_posts: 1, resource_links: 1 });
    expect(JSON.stringify(accounts)).toContain("https://x.com/dave/status/1");
    const second = await deriveFindings({ outDir: directory, project: loadProject("movies") });
    expect(second.cached).toBe(true);
  });

  it("builds a report from saved findings", async () => {
    await deriveFindings({ outDir: directory, project: loadProject("movies") });
    expect(buildReport(directory)).toContain("@dave");
  });

  it("invalidates the derivation cache when a post's author is corrected", async () => {
    await deriveFindings({ outDir: directory, project: loadProject("movies") });
    const corrected = {
      ...post("1", "Criterion and MUBI tonight", "dave", "900"),
      author_handle: "correct_author",
      observed_at: "2026-11-25T00:00:01.000Z",
    };
    const store = new DiscoveryStore(join(directory, "discovery.db"));
    const run = newRun("1725684628491739136", "home-for-you", 5);
    store.beginRun(run);
    store.commitPage({
      runId: run.runId,
      accountId: run.accountId,
      feed: run.feed,
      page: 2,
      data: { data: {} },
      posts: [corrected],
      cursor: null,
      accounting: { total: 1, posts: 1, cursors: 0, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 },
    });
    store.close();
    const second = await deriveFindings({ outDir: directory, project: loadProject("movies") });
    expect(second.cached).toBe(false);
    const accounts = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(accounts.map((account) => account["handle"])).toContain("correct_author");
  });

  it("tracks every qualifying post, not just the first three presentation examples", async () => {
    const store = new DiscoveryStore(join(directory, "discovery.db"));
    const run = newRun("1725684628491739136", "home-for-you", 5);
    store.beginRun(run);
    const posts: DiscoveredPost[] = [
      { ...post("10", "criterion mubi", "dave", "900"), urls: [] },
      { ...post("11", "arthouse mubi", "dave", "900"), urls: [] },
      { ...post("12", "avant-garde film", "dave", "900"), urls: [] },
      { ...post("13", "a short note", "dave", "900"), urls: [{ url: "https://drive.google.com/file/d/lower", display_url: "drive" }] },
    ];
    store.commitPage({
      runId: run.runId,
      accountId: run.accountId,
      feed: run.feed,
      page: 2,
      data: { data: {} },
      posts,
      cursor: null,
      accounting: { total: posts.length, posts: posts.length, cursors: 0, nonPost: 0, unavailable: 0, unsupported: 0, postBearingUnsupported: 0, modulePosts: 0 },
    });
    store.close();
    await deriveFindings({ outDir: directory, project: loadProject("movies") });
    const ledgerPath = join(directory, "finds.jsonl");
    const result = trackFinds({ outDir: directory, project: loadProject("movies"), ledgerPath });
    expect(result.added).toBe(5);
    const records = readLedger(ledgerPath);
    expect(records.map((record) => record.tweet_id)).toContain("13");
    expect(records.find((record) => record.tweet_id === "13")?.links).toContain("https://drive.google.com/file/d/lower");
  });
});
