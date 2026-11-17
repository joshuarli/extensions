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

  it("decodes X's \\xNN hex escapes inside the embedded payload", () => {
    const tweet = {
      __isTweetResult: "Tweet",
      __typename: "Tweet",
      rest_id: "2064348827385987441",
      details: { full_text: "a < b", created_at_ms: 1763600000000 },
      legacy: { lang: "en" },
      core: {
        user_results: {
          result: {
            __typename: "User",
            rest_id: "9",
            core: { name: "Some One", screen_name: "someone" },
            relationship_counts: { followers: 10 },
            verification: {},
          },
        },
      },
      counts: {},
      url_entities: [],
      mention_entities: [],
      hashtag_entities: [],
      views: { count: "1" },
    };
    const payload = JSON.stringify({
      data: {
        threaded_conversation_with_injections_v2: {
          id: "LoggedOutRepliesProduct-Timeline",
          instructions: [{
            __typename: "TimelineAddEntries",
            entries: [{
              content: {
                __typename: "TimelineTimelineItem",
                content: {
                  __typename: "TimelineTweet",
                  tweet_results: { rest_id: "2064348827385987441", result: tweet },
                },
              },
            }],
          }],
        },
      },
    });
    const wrapped = '"' + payload.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/</gu, "\\x3C") + '"';
    const page = `<html><head></script><body><script nonce="x">{\n"result":$R[1]={kind:"Result.Ok",value:${wrapped}};</script></body></html>`;
    const tweets = extractConversationTweets(page).tweets;
    expect(tweets).toHaveLength(1);
    expect((tweets[0] as { details: { full_text: string } }).details.full_text).toBe("a < b");
  });
});
