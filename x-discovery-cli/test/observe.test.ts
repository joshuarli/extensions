import { describe, expect, it } from "vitest";
import { extractCursorValues, selectExchange, type RecordedExchange } from "../src/observe.ts";

function exchange(values: Record<string, unknown>): RecordedExchange {
  return { method: "POST", path: "/i/api/graphql/abc/HomeTimeline", values, cursors: [], responseKeys: [], headers: {} };
}

describe("observation continuation", () => {
  it("extracts bottom cursors from a timeline response", () => {
    const body = { data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries: [
      { entryId: "cursor-bottom-1", content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: "next-page" } },
    ] }] } } } };
    expect(extractCursorValues(body)).toEqual(["next-page"]);
  });

  it("selects the request that actually uses a cursor from the preceding response", () => {
    const initial = exchange({ count: 20, requestContext: "launch" });
    const unrelated = exchange({ count: 20, requestContext: "launch" });
    const continuation = exchange({ count: 20, cursor: "next-page" });
    const exchanges = [initial, unrelated, continuation];
    const consumed = new Set([0]);
    expect(selectExchange(exchanges, consumed)).toBe(1);
    expect(selectExchange(exchanges, consumed, ["next-page"])).toBe(2);
  });

  it("reports an incomplete continuation instead of inventing one", () => {
    const exchanges = [exchange({ count: 20 }), exchange({ count: 20, cursor: "unrelated" })];
    expect(selectExchange(exchanges, new Set([0]), ["next-page"])).toBeNull();
  });
});
