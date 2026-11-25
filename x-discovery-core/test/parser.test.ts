import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUserList } from "../../x-archive-core/src/parser.ts";
import { parseHomeTimeline, type ParsedHomeTimeline } from "../src/parser.ts";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/home-timeline.json", import.meta.url), "utf8"),
);
const now = "2026-11-24T00:00:00.000Z";

function valid(result: ParsedHomeTimeline) {
  if (!result.valid) throw new Error(result.detail);
  return result;
}

describe("parseHomeTimeline", () => {
  it("extracts organic posts, expanded links, relationship and the bottom cursor", () => {
    const parsed = valid(parseHomeTimeline(fixture, now));
    expect(parsed.nextCursor).toBe("cursor-bottom");
    expect(parsed.posts).toHaveLength(1);
    expect(parsed.posts[0]).toMatchObject({
      tweet_id: "100",
      author_id: "900",
      author_handle: "arthouse_dave",
      author_name: "Dave",
      relationship: { kind: "original", source_tweet_id: null, source_handle: null },
      observed_at: now,
    });
    expect(parsed.posts[0]?.full_text).toContain("Criterion");
    expect(parsed.posts[0]?.urls[0]?.url).toBe("https://drive.google.com/file/d/xyz/view");
    expect(parsed.accounting).toMatchObject({
      total: 5, posts: 1, cursors: 2, nonPost: 1, unavailable: 1, unsupported: 0, postBearingUnsupported: 0,
    });
  });

  it("fails loudly on post-bearing modules instead of dropping posts", () => {
    const data = {
      data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries: [
        { entryId: "module-1", content: { entryType: "TimelineTimelineModule", items: [
          { item: { itemContent: { tweet_results: { result: { rest_id: "9" } } } } },
        ] } },
      ] }] } } },
    };
    const result = parseHomeTimeline(data, now);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.detail).toContain("post-bearing modules");
    expect(result.accounting.postBearingUnsupported).toBe(1);
  });

  it("fails loudly when the timeline instruction is missing", () => {
    const result = parseHomeTimeline({ data: { home: {} } }, now);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected failure");
    expect(result.detail).toContain("TimelineAddEntries");
  });
});

describe("parseUserList", () => {
  const listPage = (entries: unknown[]) => ({
    data: { user: { result: { timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } } } },
  });

  it("extracts users and the bottom cursor and accounts for unsupported entries", () => {
    const data = listPage([
      { entryId: "user-1", content: { entryType: "TimelineTimelineItem", itemContent: { user_results: { result: {
        __typename: "User", rest_id: "1", core: { screen_name: "dave", name: "Dave" },
      } } } } },
      { entryId: "module-1", content: { entryType: "TimelineTimelineModule", items: [] } },
      { entryId: "cursor-bottom", content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: "next" } },
    ]);
    const result = parseUserList(data, now);
    expect(result).toMatchObject({ valid: true, nextCursor: "next", unsupported: 1 });
    expect(result.users).toEqual([{ user_id: "1", handle: "dave", name: "Dave", observed_at: now }]);
  });

  it("fails loudly when the user list envelope is missing", () => {
    const result = parseUserList({ data: { user: {} } }, now);
    expect(result.valid).toBe(false);
    expect(result.detail).toContain("TimelineAddEntries");
  });
});
