import { describe, expect, it } from "vitest";
import { delay, profileTimelineVariables } from "../src/collector.ts";

describe("profile timeline variables", () => {
  it("sends withVoice/withCommunity and fieldToggles defaults for the renamed operations", () => {
    expect(profileTimelineVariables("UserOriginalsTimeline", "44196397", null))
      .toMatchObject({ userId: "44196397", withVoice: true, withQuickPromoteEligibilityTweetFields: true });
    expect(profileTimelineVariables("UserRepliesTimeline", "44196397", null))
      .toMatchObject({ userId: "44196397", withVoice: true, withCommunity: true });
    expect(profileTimelineVariables("UserRepliesTimeline", "44196397", "cursor-x"))
      .toMatchObject({ cursor: "cursor-x" });
    expect(profileTimelineVariables("UserTweets", "44196397", null))
      .toEqual({ userId: "44196397", count: 20, includePromotedContent: false });
  });
});

describe("delay", () => {
  it("immediately cancels an interrupted retry delay", async () => {
    const abort = new AbortController();
    const result = delay(60_000, abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow("Stopped by user");
  });
});
