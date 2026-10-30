import { describe, expect, it } from "vitest";
import { parseFolders, parseTimeline } from "../src/parser.ts";

const now = "2026-10-30T00:00:00.000Z";
const entry = (result: unknown, id = "123") => ({
  entryId: "tweet-" + id, sortIndex: "999", content: { itemContent: { tweet_results: { result } } },
});
const page = (entries: unknown[], key = "bookmark_timeline_v2") => ({
  data: { [key]: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } } },
});
const cursor = { entryId: "cursor-bottom-0", content: { value: "next" } };

describe("bookmark timelines", () => {
  it("extracts long-form text, author, media and continuation cursor", () => {
    const data = page([entry({
      rest_id: "123",
      core: { user_results: { result: { core: { screen_name: "user", name: "Name" },
        avatar: { image_url: "https://example.com/avatar.jpg" } } } },
      note_tweet: { note_tweet_results: { result: { text: "Full text",
        entity_set: { urls: [{ expanded_url: "https://example.com" }] } } } },
      legacy: { full_text: "Truncated", extended_entities: {
        media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/file.jpg" }],
      } },
    }), cursor]);
    const result = parseTimeline(data, now);
    expect(result.valid).toBe(true);
    expect(result.nextCursor).toBe("next");
    const post = result.bookmarks[0];
    expect(post?.full_text).toBe("Full text");
    expect(post?.author).toMatchObject({ screen_name: "user" });
    expect(post?.entities).toMatchObject({ urls: [{ expanded_url: "https://example.com" }] });
    expect(post?.media).toMatchObject([{ url: "https://pbs.twimg.com/file.jpg?format=jpg&name=orig" }]);
  });

  it("preserves tombstones and visibility wrappers", () => {
    for (const missing of [null, { __typename: "TweetTombstone" },
      { __typename: "TweetWithVisibilityResults", tweet: null }]) {
      const post = parseTimeline(page([entry(missing)]), now).bookmarks[0];
      expect(post).toMatchObject({ tweet_id: "123", status: "unavailable" });
    }
  });

  it("accepts folder timelines but rejects changed shapes and unknown entries", () => {
    expect(parseTimeline(page([entry({ rest_id: "123" })], "bookmark_collection_timeline"), now).valid).toBe(true);
    expect(parseTimeline({}, now).valid).toBe(false);
    expect(parseTimeline(page([{ entryId: "mystery" }]), now).valid).toBe(false);
    expect(parseTimeline(page([{ entryId: "cursor-bottom-0", content: { value: 1 } }]), now).valid).toBe(false);
    expect(parseTimeline(page([null]), now).valid).toBe(false);
  });

  it("reads folders and their next cursor", () => {
    const result = parseFolders({ data: { viewer: { user_results: { result: {
      bookmark_collections_slice: { items: [{ id: "f1", name: "Research" }],
        slice_info: { next_cursor: "cursor" } },
    } } } } });
    expect(result).toEqual({ valid: true, folders: [{ id: "f1", name: "Research" }], nextCursor: "cursor" });
    expect(parseFolders({ data: { viewer: { user_results: { result: {
      bookmark_collections_slice: { items: [null] },
    } } } } }).valid).toBe(false);
  });
});
