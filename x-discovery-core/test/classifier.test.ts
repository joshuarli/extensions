import { describe, expect, it } from "vitest";
import { ARTHOUSE_THRESHOLD, classifyPost, classifyPosts, summarizeAccounts } from "../src/classifier.ts";
import type { DiscoveredPost } from "../src/post.ts";

function post(id: string, handle: string, full_text: string, url?: string): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: handle === "dave" ? "900" : "901",
    author_handle: handle,
    author_name: null,
    created_at: "",
    full_text,
    lang: "en",
    urls: url ? [{ url, display_url: "drive.google.com/file" }] : [],
    favorite_count: 0,
    retweet_count: 0,
    observed_at: "now",
  };
}

describe("classifyPost", () => {
  it("scores arthouse signals and extracts a drive link from an expanded URL", () => {
    const signal = classifyPost(post("1", "dave", "Criterion and MUBI picks tonight", "https://drive.google.com/file/d/abc/view"));
    expect(signal.score).toBeGreaterThanOrEqual(ARTHOUSE_THRESHOLD);
    expect(signal.is_arthouse).toBe(true);
    expect(signal.matched_terms).toContain("criterion");
    expect(signal.links).toEqual([{
      url: "https://drive.google.com/file/d/abc/view",
      host: "drive.google.com",
      display_url: "drive.google.com/file",
    }]);
  });

  it("ignores a film word below the threshold and non-drive hosts", () => {
    const signal = classifyPost(post("2", "other", "Saw a movie today https://example.com/thing"));
    expect(signal.score).toBe(1);
    expect(signal.is_arthouse).toBe(false);
    expect(signal.links).toEqual([]);
  });
});

describe("summarizeAccounts", () => {
  it("ranks accounts by score and link count", () => {
    const posts = [
      post("1", "dave", "criterion mubi", "https://mega.nz/file/one"),
      post("2", "dave", "auteur cinema", "https://mega.nz/file/two"),
      post("3", "other", "movie"),
    ];
    const accounts = summarizeAccounts(posts, classifyPosts(posts));
    expect(accounts[0]?.handle).toBe("dave");
    expect(accounts[0]).toMatchObject({ posts: 2, arthouse_posts: 2, drive_links: 2 });
    expect(accounts[0]?.sample_links).toHaveLength(2);
    expect(accounts[1]).toMatchObject({ handle: "other", arthouse_posts: 0 });
  });
});
