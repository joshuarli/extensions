import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoveredPost } from "../src/post.ts";
import { appendNewPosts, readCursor, readPosts, writeCursor } from "../src/store.ts";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(process.cwd(), ".work/tmp", "x-discovery-store-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function post(id: string): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: "900",
    author_handle: "dave",
    author_name: null,
    created_at: "",
    full_text: "criterion",
    lang: "en",
    urls: [],
    favorite_count: 0,
    retweet_count: 0,
    observed_at: "now",
  };
}

describe("store", () => {
  it("appends only unseen posts and validates records on read", () => {
    const path = join(directory, "posts.jsonl");
    expect(appendNewPosts(path, [post("1"), post("2")])).toEqual({ written: 2, duplicates: 0 });
    expect(appendNewPosts(path, [post("2"), post("3")])).toEqual({ written: 1, duplicates: 1 });
    expect(readPosts(path).map((record) => record.tweet_id)).toEqual(["1", "2", "3"]);
  });

  it("rejects a corrupt record instead of silently skipping it", () => {
    const path = join(directory, "bad.jsonl");
    writeFileSync(path, '{"tweet_id":"1"}\n');
    expect(() => readPosts(path)).toThrow("Invalid discovery post at line 1");
  });

  it("round-trips the resume cursor", () => {
    const path = join(directory, "cursor.json");
    expect(readCursor(path)).toBeNull();
    writeCursor(path, "next-page");
    expect(readCursor(path)).toBe("next-page");
    writeCursor(path, null);
    expect(readCursor(path)).toBeNull();
  });
});
