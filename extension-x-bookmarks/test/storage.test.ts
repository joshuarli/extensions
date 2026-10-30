import { describe, expect, it } from "vitest";
import { parseTimeline } from "../src/parser.ts";
import { mergeBookmark } from "../src/storage.ts";
import { buildGraphqlUrl } from "../src/api.ts";
import { delay } from "../src/collector.ts";

function record(result: unknown) {
  const data = { data: { bookmark_timeline_v2: { timeline: {
    instructions: [{ type: "TimelineAddEntries", entries: [{
      entryId: "tweet-111", content: { itemContent: { tweet_results: { result } } },
    }] }],
  } } } };
  const parsed = parseTimeline(data, "2026-10-30T00:00:00Z").bookmarks[0];
  if (!parsed) throw new Error("Parser did not return a record.");
  return parsed;
}

describe("storage, account boundaries and requests", () => {
  it("preserves prior content on tombstones and deduplicates folder membership", () => {
    const full = record({ rest_id: "111", legacy: { full_text: "Original content" } });
    const missing = record(null);
    const first = mergeBookmark(undefined, full, "folder-1");
    const second = mergeBookmark(first, missing, "folder-1");
    expect(second.status).toBe("available");
    expect(second.full_text).toBe("Original content");
    expect(second.folder_ids).toEqual(["folder-1"]);
    const third = mergeBookmark(second, record({ rest_id: "111", legacy: { full_text: "" } }), "folder-2");
    expect(third.full_text).toBe("Original content");
    expect(third.folder_ids).toEqual(["folder-1", "folder-2"]);
  });

  it("encodes X GraphQL variables, operation and flags without guessing query IDs", () => {
    const url = new URL(buildGraphqlUrl("abc_-", "Bookmarks", { count: 100, cursor: "a&b" }, '{"flag":true}'));
    expect(url.pathname).toBe("/i/api/graphql/abc_-/Bookmarks");
    expect(JSON.parse(url.searchParams.get("variables") ?? "{}")).toEqual({ count: 100, cursor: "a&b" });
    expect(JSON.parse(url.searchParams.get("features") ?? "{}")).toEqual({ flag: true });
    expect(() => buildGraphqlUrl("../../exploit", "Bookmarks", {}, undefined)).toThrow();
  });

  it("immediately cancels an interrupted retry delay", async () => {
    const abort = new AbortController();
    const result = delay(60_000, abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow("Stopped by user");
  });
});
