import { describe, expect, it } from "vitest";
import { deriveAccounts } from "../src/accounts.ts";
import { extractResourceLinks } from "../src/links.ts";
import type { DiscoveredPost } from "../src/post.ts";
import { classifyTopic } from "../src/topic.ts";
import { loadProject } from "../src/project.ts";

const movies = loadProject("movies");

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
    const judgment = classifyTopic(post("1", "dave", "900", "Criterion and MUBI picks tonight"), movies);
    expect(judgment.score).toBeGreaterThanOrEqual(movies.relevance_threshold);
    expect(judgment.verdict).toBe("relevant");
    expect(judgment.matched_terms).toContain("criterion");
    expect(judgment.reason).toContain("criterion");
  });

  it("reports insufficient textual evidence instead of guessing", () => {
    const judgment = classifyTopic(post("2", "dave", "900", "📼"), movies);
    expect(judgment.verdict).toBe("insufficient_evidence");
  });
});

describe("extractResourceLinks", () => {
  it("keeps query parameters in the dedupe key and records association", () => {
    const links = extractResourceLinks(post("3", "dave", "900", "mirror", "https://drive.google.com/file/d/abc/view?usp=sharing"), movies);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      host: "drive.google.com",
      association: "entity",
      source_tweet_id: "3",
    });
    expect(links[0]?.dedupe_key).toContain("usp=sharing");
  });

  it("ignores non-resource hosts", () => {
    expect(extractResourceLinks(post("4", "dave", "900", "https://example.com/thing"), movies)).toEqual([]);
  });

  it("preserves fragments so distinct file keys stay distinct", () => {
    const first = extractResourceLinks(post("5", "dave", "900", "", "https://mega.nz/file/A#KEY_A"), movies);
    const second = extractResourceLinks(post("6", "dave", "900", "", "https://mega.nz/#!B!KEY_B"), movies);
    const third = extractResourceLinks(post("7", "dave", "900", "", "https://mega.nz/#!C!KEY_C"), movies);
    expect(first[0]?.url).toBe("https://mega.nz/file/A#KEY_A");
    expect(second[0]?.dedupe_key).not.toBe(third[0]?.dedupe_key);
  });
});

describe("deriveAccounts", () => {
  it("produces an explainable ranking with roles and uncertainty", () => {
    const posts = [
      post("1", "dave", "900", "criterion mubi", "https://mega.nz/file/one"),
      post("2", "dave", "900", "auteur cinema", "https://mega.nz/file/two", true),
      post("3", "other", "901", "movie"),
    ];
    const topics = posts.map((entry) => classifyTopic(entry, movies));
    const links = posts.flatMap((entry) => extractResourceLinks(entry, movies));
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
