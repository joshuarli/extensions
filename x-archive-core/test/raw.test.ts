import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BookmarkSchema, parseTimeline, type RawBookmark } from "../src/parser.ts";
import { mergeBookmark } from "../src/merge.ts";
import { parseContextTweet } from "../src/conversation.ts";
import { decodeBookmark, rederiveBookmark } from "../src/raw.ts";

const observedAt = "2026-11-25T00:00:00.000Z";

const rawResult = {
  __typename: "Tweet",
  rest_id: "123",
  future_field: { note_tweet_entities: ["kept"] },
  core: { user_results: { result: { rest_id: "42", core: { screen_name: "alice", name: "Alice" } } } },
  legacy: {
    created_at: "Wed Oct 10 20:19:24 +0000 2018",
    full_text: "Full text from the raw result",
    lang: "en",
    conversation_id_str: "123",
    favorite_count: 7,
  },
  card: { legacy: { name: "poll:card", binding_values: [{ key: "title", value: { string_value: "Raw card title" } }] } },
};

function bookmark(result: unknown) {
  const data = { data: { bookmark_timeline_v2: { timeline: { instructions: [{
    type: "TimelineAddEntries",
    entries: [{ entryId: "tweet-123", sortIndex: "999", content: { itemContent: { tweet_results: { result } } } }],
  }] } } } };
  const parsed = parseTimeline(data, observedAt);
  const found = parsed.bookmarks[0];
  if (!found) throw new Error("Parser did not return a record.");
  return found;
}

describe("raw tweet preservation", () => {
  it("attaches the unmodified GraphQL result to a collected bookmark", () => {
    const collected = bookmark(rawResult);
    expect(collected.raw_tweet).toEqual(rawResult);
    expect((collected.raw_tweet as { future_field: unknown })["future_field"]).toEqual({ note_tweet_entities: ["kept"] });
    expect(Schema.decodeUnknownSync(BookmarkSchema)(collected)).not.toHaveProperty("raw_tweet");
  });

  it("decodes normalized fields without dropping the raw payload", () => {
    const decoded = decodeBookmark({ ...bookmark(rawResult), full_text: "stale" });
    expect(decoded.full_text).toBe("stale");
    expect(decoded.raw_tweet).toEqual(rawResult);
    expect(() => decodeBookmark({ tweet_id: "123" })).toThrow();
  });

  it("keeps the payload that belongs to the surviving record when merging", () => {
    const available = bookmark(rawResult);
    const incoming = { ...bookmark({ ...rawResult, future_field: "newer" }), status: "unavailable" as const };
    const kept = mergeBookmark(available, incoming);
    expect(kept.status).toBe("available");
    expect((kept.raw_tweet as { future_field: unknown })["future_field"]).toEqual({ note_tweet_entities: ["kept"] });

    const refreshed = mergeBookmark(kept, bookmark({ ...rawResult, future_field: "newer" }));
    expect(refreshed.raw_tweet).toEqual({ ...rawResult, future_field: "newer" });
  });

  it("re-derives the normalized view from the raw payload at export", () => {
    const stored: RawBookmark = {
      ...bookmark(rawResult),
      full_text: "stale text",
      card: null,
      folder_ids: ["folder-1"],
      status: "available",
    };
    const derived = rederiveBookmark(stored);
    expect(derived.full_text).toBe("Full text from the raw result");
    expect(derived.card).toMatchObject({ title: "Raw card title" });
    expect(derived.folder_ids).toEqual(["folder-1"]);
    expect(derived.status).toBe("available");
    expect(derived.observed_at).toBe(observedAt);
    expect(derived.raw_tweet).toEqual(rawResult);

    const withoutRaw = rederiveBookmark({ ...stored, raw_tweet: undefined });
    expect(withoutRaw.full_text).toBe("stale text");
    expect(withoutRaw.raw_tweet).toBeUndefined();
  });

  it("does not blank context text whose raw shape has no legacy full text", () => {
    const context = parseContextTweet({
      rest_id: "777",
      details: { full_text: "ancestor text", created_at_ms: 1_600_000_000_000 },
      core: { user_results: { result: { rest_id: "42", core: { screen_name: "alice" } } } },
    }, "555", observedAt);
    expect(context?.raw_tweet).toMatchObject({ rest_id: "777" });
    const derived = rederiveBookmark({ ...context!, full_text: "ancestor text" });
    expect(derived.full_text).toBe("ancestor text");
    expect(derived.created_at).toBe("2020-09-13T12:26:40.000Z");
  });
});
