import { describe, expect, it } from "vitest";
import { mergeBookmark } from "../src/merge.ts";
import { parseTimeline } from "../src/parser.ts";

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

describe("bookmark merge", () => {
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
});
