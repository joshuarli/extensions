import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/project.ts";
import type { DiscoveredPost } from "../src/post.ts";
import { classifyTopic } from "../src/topic.ts";

interface Case {
  text: string;
  expected: "relevant" | "unrelated" | "insufficient_evidence";
  note: string;
  resource?: boolean;
}

const cases: Case[] = JSON.parse(
  readFileSync(new URL("./fixtures/movies-eval.json", import.meta.url), "utf8"),
) as Case[];
const movies = loadProject("movies");

function post(text: string): DiscoveredPost {
  return {
    tweet_id: "1",
    author_id: "900",
    author_handle: "dave",
    author_name: null,
    created_at: "",
    full_text: text,
    lang: "en",
    urls: [],
    favorite_count: 0,
    retweet_count: 0,
    observed_at: "2026-11-25T00:00:00.000Z",
  };
}

describe("movies topic evaluation", () => {
  it("classifies every labeled case and keeps resource-bearing recall", () => {
    const wrong = cases.filter((entry) => classifyTopic(post(entry.text), movies).verdict !== entry.expected);
    expect(wrong.map((entry) => entry.note + ": " + entry.text)).toEqual([]);
    const resourceCases = cases.filter((entry) => entry.resource === true);
    expect(resourceCases.length).toBeGreaterThanOrEqual(3);
    expect(resourceCases.every((entry) => classifyTopic(post(entry.text), movies).verdict === "relevant")).toBe(true);
  });

  it("does not read a topic from a handle or a bare URL", () => {
    const judgment = classifyTopic(post("RT @gothicfilms: https://t.co/example"), movies);
    expect(judgment.matched_terms).toEqual([]);
    expect(judgment.verdict).toBe("unrelated");
  });

  it("ranks a focused account above a high-volume mixed account", async () => {
    const { deriveAccounts } = await import("../src/accounts.ts");
    const { extractResourceLinks } = await import("../src/links.ts");
    const make = (id: string, relevant: number): DiscoveredPost[] => Array.from({ length: relevant }, (_, index) => ({
      ...post(id + "-" + index),
      tweet_id: id + "-" + index,
      full_text: "Criterion and MUBI picks tonight",
      author_id: id,
      author_handle: id,
    }));
    const focused = make("focused", 10);
    const mixed = [...make("mixed", 12), ...Array.from({ length: 88 }, (_, index) => ({
      ...post("noise-" + index),
      tweet_id: "noise-" + index,
      full_text: "Just another ordinary update about the weather today",
      author_id: "mixed",
      author_handle: "mixed",
    }))];
    const posts = [...focused, ...mixed];
    const topics = posts.map((entry) => classifyTopic(entry, movies));
    const links = posts.flatMap((entry) => extractResourceLinks(entry, movies));
    const accounts = deriveAccounts(posts, topics, links);
    expect(accounts[0]?.handle).toBe("focused");
    expect(accounts[0]?.uncertainty).not.toBe(accounts.find((account) => account.handle === "mixed")?.uncertainty);
  });
});
