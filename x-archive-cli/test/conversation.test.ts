import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractConversationTweets,
  parseContextTweet,
} from "../../x-archive-core/src/conversation.ts";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "conversation-page.html"), "utf8");
const observedAt = "2026-11-17T00:00:00.000Z";

describe("conversation page extraction", () => {
  it("collects timeline tweets from plain entries and conversation modules", () => {
    const page = extractConversationTweets(html);
    expect(page.tweets.map((tweet) => tweet["rest_id"]).sort()).toEqual([
      "2121990160426381595",
      "2121990345332576733",
      "2121991008691130620",
    ]);
  });

  it("maps tweets to archive records with the parent chain intact", () => {
    const page = extractConversationTweets(html);
    const records = page.tweets.map((tweet) => parseContextTweet(tweet, "2121990160426381595", observedAt));
    expect(records.every((record) => record !== null)).toBe(true);
    const byId = new Map(records.map((record) => [record!.tweet_id, record!]));
    const root = byId.get("2121990160426381595")!;
    expect(root.in_reply_to_tweet_id).toBeNull();
    const rootAuthor = root.author as Record<string, unknown>;
    expect(rootAuthor["screen_name"]).toBe("cafeantinomie");
    expect(root.full_text).toContain("invent the mathematics");
    const rootMetrics = root.metrics as Record<string, unknown>;
    expect(rootMetrics["likes"]).toBe(853);
    const patriot = byId.get("2121990345332576733")!;
    expect(patriot.in_reply_to_tweet_id).toBe("2121990160426381595");
    expect((patriot.author as Record<string, unknown>)["screen_name"]).toBe("akib27690640");
    expect(patriot.conversation_id).toBe("2121990160426381595");
    const nested = byId.get("2121991008691130620")!;
    expect(nested.in_reply_to_tweet_id).toBe("2121990345332576733");
    expect(nested.lang).toBeTruthy();
  });

  it("survives a page without an embedded conversation payload", () => {
    expect(() => extractConversationTweets("<html><head></head><body>not found</body></html>"))
      .toThrow(/conversation payload/u);
  });
});
