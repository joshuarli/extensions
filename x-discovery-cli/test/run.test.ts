import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoveredPost } from "../../x-discovery-core/src/index.ts";
import { writeDerived } from "../src/run.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(process.cwd(), ".work/tmp", "x-discovery-cli-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function post(id: string, handle: string, authorId: string, text: string, drive: boolean): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: authorId,
    author_handle: handle,
    author_name: null,
    created_at: "",
    full_text: text,
    lang: "en",
    urls: drive ? [{ url: "https://mega.nz/file/" + id, display_url: "mega.nz" }] : [],
    favorite_count: 0,
    retweet_count: 0,
    observed_at: "now",
  };
}

describe("writeDerived", () => {
  it("writes per-post signals and ranked accounts", () => {
    const posts = [
      post("1", "dave", "900", "Criterion and MUBI tonight", true),
      post("2", "dave", "900", "movie", false),
      post("3", "other", "901", "movie", false),
    ];
    const { signals, accounts } = writeDerived(directory, posts);
    expect(signals).toHaveLength(3);
    expect(accounts[0]).toMatchObject({ handle: "dave", posts: 2, arthouse_posts: 1, drive_links: 1 });
    const written = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8")) as unknown;
    expect(written).toEqual(accounts);
    expect(readFileSync(join(directory, "signals.json"), "utf8")).toContain("mega.nz");
  });
});
