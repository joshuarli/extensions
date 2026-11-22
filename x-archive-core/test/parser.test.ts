import { describe, expect, it } from "vitest";
import { parseFolders, parseTimeline } from "../src/parser.ts";

const now = "2026-10-30T00:00:00.000Z";
const entry = (result: unknown, id = "123") => ({
  entryId: "tweet-" + id, sortIndex: "999", content: { itemContent: { tweet_results: { result } } },
});
const timeline = (instructions: unknown, key = "bookmark_timeline_v2") => ({
  data: { [key]: { timeline: { instructions } } },
});
const page = (entries: unknown[], key?: string) => timeline([{ type: "TimelineAddEntries", entries }], key);
const folderPage = (slice: unknown) => ({
  data: { viewer: { user_results: { result: { bookmark_collections_slice: slice } } } },
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

  it("accepts folder timelines and skips unknown modules", () => {
    expect(parseTimeline(page([entry({ rest_id: "123" })], "bookmark_collection_timeline"), now).valid).toBe(true);
    expect(parseTimeline(page([{ entryId: "mystery" }]), now).valid).toBe(true);
  });

  it.each([
    { data: {}, detail: "timeline instructions are missing or not an array" },
    { data: timeline([{}]), detail: 'unsupported instruction "unknown"' },
    { data: timeline([{ type: "TimelineAddToModule" }]), detail: 'unsupported instruction "TimelineAddToModule"' },
    { data: page([null]), detail: "stream contained a non-object entry" },
    { data: page([{}]), detail: "timeline entry has no entryId" },
    {
      data: page([{ entryId: "tweet-", sortIndex: "1", content: { itemContent: {} } }]),
      detail: 'entry "tweet-" did not match the tweet shape',
    },
    {
      data: page([{ entryId: "cursor-bottom-0", content: { value: 1 } }]),
      detail: 'cursor entry "cursor-bottom-0" has no content.value',
    },
  ])("reports $detail", ({ data, detail }) => {
    expect(parseTimeline(data, now)).toEqual({ valid: false, bookmarks: [], nextCursor: null, detail });
  });

  it("reads folders and their next cursor", () => {
    const result = parseFolders(folderPage({
      items: [{ id: "f1", name: "Research" }], slice_info: { next_cursor: "cursor" },
    }));
    expect(result).toEqual({ valid: true, folders: [{ id: "f1", name: "Research" }], nextCursor: "cursor" });
  });

  it("reads the collection ID fallback and an explicit final cursor", () => {
    expect(parseFolders(folderPage({
      items: [{ collection_id: "f2", name: "Saved" }], slice_info: { next_cursor: null },
    }))).toEqual({ valid: true, folders: [{ id: "f2", name: "Saved" }], nextCursor: null });
  });

  it.each([
    { label: "missing slice", slice: undefined },
    { label: "missing items", slice: {} },
    { label: "non-string cursor", slice: { items: [], slice_info: { next_cursor: 1 } } },
    { label: "missing ID", slice: { items: [{ name: "Unnamed" }] } },
    { label: "missing name after a valid folder", slice: { items: [{ id: "f1", name: "Research" }, { id: "f2" }] } },
    { label: "non-object item", slice: { items: [null] } },
  ])("rejects a folder page with $label", ({ slice }) => {
    expect(parseFolders(folderPage(slice))).toEqual({ valid: false, folders: [], nextCursor: null });
  });

  it("reads a replacement cursor from the older bookmark timeline", () => {
    const instructions = [
      { type: "TimelineAddEntries", entries: [cursor] },
      { type: "TimelineReplaceEntry", entry: { entryId: "cursor-bottom-1", content: { value: "replacement" } } },
    ];
    const data = timeline(instructions, "bookmark_timeline");
    expect(parseTimeline(data, now)).toEqual({
      valid: true, bookmarks: [], nextCursor: "replacement", terminated: false,
    });
  });

  it("rejects an instruction without entries after a valid cursor", () => {
    const instructions = [{ type: "TimelineAddEntries", entries: [cursor] }, { type: "TimelineAddEntries" }];
    const data = timeline(instructions);
    expect(parseTimeline(data, now)).toEqual({
      valid: false, bookmarks: [], nextCursor: null, detail: '"TimelineAddEntries" instruction has no entries array',
    });
  });
});

describe("timeline modules", () => {
  it("skips who-to-follow and other module entries but keeps posts and cursors", () => {
    const data = page([
      { entryId: "who-to-follow-123", sortIndex: "1", content: { entryType: "TimelineTimelineModule", displayType: "Vertical", items: [] } },
      entry({ rest_id: "123", legacy: { full_text: "kept" } }, "123"),
      { entryId: "ad-2122361160534589438", sortIndex: "2", content: { entryType: "TimelineTimelineModule" } },
      cursor,
    ]);
    const result = parseTimeline(data, now);
    expect(result.valid).toBe(true);
    expect(result.bookmarks.map((bookmark) => bookmark.tweet_id)).toEqual(["123"]);
    expect(result.nextCursor).toBe("next");
  });

  it("surfaces the terminate instruction as the end of the timeline", () => {
    const instructions = [{ type: "TimelineAddEntries", entries: [cursor] }, { type: "TimelineTerminateTimeline" }];
    const data = timeline(instructions);
    const result = parseTimeline(data, now);
    expect(result.valid).toBe(true);
    expect(result.terminated).toBe(true);
  });
});
