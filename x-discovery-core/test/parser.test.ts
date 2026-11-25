import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHomeTimeline } from "../src/parser.ts";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/home-timeline.json", import.meta.url), "utf8"),
);

describe("parseHomeTimeline", () => {
  it("extracts organic posts, expanded links and the bottom cursor", () => {
    const parsed = parseHomeTimeline(fixture, "2026-11-24T00:00:00.000Z");
    expect(parsed.valid).toBe(true);
    expect(parsed.nextCursor).toBe("cursor-bottom");
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0]).toMatchObject({
      tweet_id: "100",
      author_id: "900",
      author_handle: "arthouse_dave",
      author_name: "Dave",
      lang: "en",
      favorite_count: 42,
      retweet_count: 7,
      observed_at: "2026-11-24T00:00:00.000Z",
    });
    expect(parsed.posts[0]?.full_text).toContain("Criterion");
    expect(parsed.posts[0]?.urls[0]?.url).toBe("https://drive.google.com/file/d/xyz/view");
  });

  it("fails loudly when the timeline instruction is missing", () => {
    const parsed = parseHomeTimeline({ data: { home: {} } }, "now");
    expect(parsed.valid).toBe(false);
    expect(parsed.posts).toEqual([]);
    expect(parsed.detail).toContain("TimelineAddEntries");
  });
});
