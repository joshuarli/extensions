import { describe, expect, it, vi } from "vitest";
import { collectHomeTimeline, type HomeTimelineDeps } from "../src/collector.ts";
import type { DiscoveredPost } from "../src/post.ts";

function page(cursor: string | null, tweetId: string): unknown {
  const entries: unknown[] = [{
    entryId: "tweet-" + tweetId,
    content: {
      entryType: "TimelineTimelineItem",
      itemContent: {
        tweet_results: {
          result: {
            __typename: "Tweet",
            rest_id: tweetId,
            core: {
              user_results: {
                result: {
                  __typename: "User",
                  rest_id: "900",
                  core: { screen_name: "dave", name: "Dave" },
                },
              },
            },
            legacy: { full_text: "criterion", created_at: "", lang: "en", entities: {} },
          },
        },
      },
    },
  }];
  if (cursor !== null) {
    entries.push({
      entryId: "cursor-bottom",
      content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: cursor },
    });
  }
  return { data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries }] } } } };
}

function deps(responses: unknown[], options: { maxPages?: number; cursor?: string | null } = {}): HomeTimelineDeps & {
  writes: string[][];
  cursors: (string | null)[];
} {
  const saves: string[][] = [];
  const cursors: (string | null)[] = [];
  let index = 0;
  return {
    request: vi.fn(async () => responses[Math.min(index++, responses.length - 1)]),
    savePosts: async (posts: DiscoveredPost[]) => { saves.push(posts.map((post) => post.tweet_id)); },
    readCursor: async () => options.cursor ?? null,
    writeCursor: async (cursor: string | null) => { cursors.push(cursor); },
    signal: new AbortController().signal,
    report: () => {},
    maxPages: options.maxPages ?? 5,
    pageDelayMs: 0,
    writes: saves,
    cursors,
  };
}

describe("collectHomeTimeline", () => {
  it("pages until the feed ends and clears the cursor", async () => {
    const collected = deps([page("cursor-2", "1"), page(null, "2")]);
    const result = await collectHomeTimeline(collected);
    expect(result).toMatchObject({ pages: 2, posts: 2, completed: true, reason: "timeline_complete", cursor: null });
    expect(collected.writes).toEqual([["1"], ["2"]]);
    expect(collected.cursors).toEqual(["cursor-2", null]);
  });

  it("stops at the page limit and keeps the cursor for resume", async () => {
    const collected = deps([page("cursor-2", "1"), page("cursor-3", "2")], { maxPages: 2 });
    const result = await collectHomeTimeline(collected);
    expect(result).toMatchObject({ pages: 2, posts: 2, completed: false, reason: "max_pages", cursor: "cursor-3" });
    expect(collected.cursors).toEqual(["cursor-2", "cursor-3"]);
  });

  it("detects a cursor that does not advance", async () => {
    const collected = deps([page("cursor-2", "1")], { cursor: "cursor-2", maxPages: 3 });
    const result = await collectHomeTimeline(collected);
    expect(result.reason).toBe("cursor_stalled");
    expect(collected.cursors).toEqual([]);
  });

  it("keeps the last good cursor when the response shape changes", async () => {
    const collected = deps([{}], { cursor: "cursor-1" });
    const result = await collectHomeTimeline(collected);
    expect(result).toMatchObject({ pages: 1, posts: 0, completed: false, reason: "unexpected_shape", cursor: "cursor-1" });
    expect(collected.cursors).toEqual([]);
  });

  it("does not send a request when already stopped", async () => {
    const collected = deps([page(null, "1")]);
    const controller = new AbortController();
    controller.abort();
    collected.signal = controller.signal;
    const result = await collectHomeTimeline(collected);
    expect(result).toMatchObject({ pages: 0, reason: "stopped" });
    expect(collected.request).not.toHaveBeenCalled();
  });
});
