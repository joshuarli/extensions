import { describe, expect, it } from "vitest";
import { deriveAccounts } from "../src/accounts.ts";
import { extractResourceLinks } from "../src/links.ts";
import type { DiscoveredPost } from "../src/post.ts";
import { classifyTopic, RELEVANCE_THRESHOLD } from "../src/topic.ts";

function post(id: string, handle: string, authorId: string, text: string, drive?: string, repost = false): DiscoveredPost {
  return {
    tweet_id: id,
    author_id: authorId,
    author_handle: handle,
    author_name: null,
    created_at: "",
    full_text: text,
    lang: "en",
    urls: drive ? [{ url: drive, display_url: "drive.google.com/file" }] : [],
    favorite_count: 0,
    retweet_count: 0,
    relationship: { kind: repost ? "repost" : "original", source_tweet_id: null, source_handle: null },
    observed_at: "2026-11-25T00:00:00.000Z",
  };
}

describe("classifyTopic", () => {
  it("marks strong cinema signals as relevant with an explanation", () => {
    const judgment = classifyTopic(post("1", "dave", "900", "Criterion and MUBI picks tonight"));
    expect(judgment.score).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
    expect(judgment.verdict).toBe("relevant");
    expect(judgment.matched_terms).toContain("criterion");
    expect(judgment.reason).toContain("criterion");
  });

  it("reports insufficient textual evidence instead of guessing", () => {
    const judgment = classifyTopic(post("2", "dave", "900", "📼"));
    expect(judgment.verdict).toBe("insufficient_evidence");
  });
});

describe("extractResourceLinks", () => {
  it("keeps query parameters in the dedupe key and records association", () => {
    const links = extractResourceLinks(post("3", "dave", "900", "mirror", "https://drive.google.com/file/d/abc/view?usp=sharing"));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      host: "drive.google.com",
      association: "entity",
      source_tweet_id: "3",
    });
    expect(links[0]?.dedupe_key).toContain("usp=sharing");
  });

  it("ignores non-resource hosts", () => {
    expect(extractResourceLinks(post("4", "dave", "900", "https://example.com/thing"))).toEqual([]);
  });
});

describe("deriveAccounts", () => {
  it("produces an explainable ranking with roles and uncertainty", () => {
    const posts = [
      post("1", "dave", "900", "criterion mubi", "https://mega.nz/file/one"),
      post("2", "dave", "900", "auteur cinema", "https://mega.nz/file/two", true),
      post("3", "other", "901", "movie"),
    ];
    const topics = posts.map(classifyTopic);
    const links = posts.flatMap(extractResourceLinks);
    const accounts = deriveAccounts(posts, topics, links);
    expect(accounts[0]).toMatchObject({
      handle: "dave",
      role: "both",
      posts_examined: 2,
      relevant_posts: 2,
      resource_links: 2,
      uncertainty: "thin",
    });
    expect(accounts[0]?.examples[0]?.source_url).toBe("https://x.com/dave/status/1");
    expect(accounts[1]).toMatchObject({ handle: "other", relevant_posts: 0 });
  });
});
