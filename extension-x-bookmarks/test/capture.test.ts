import { describe, expect, it } from "vitest";
import { captureRequest, mergeCapture, parseUserId } from "../src/capture.ts";

const bookmarkUrl = "https://x.com/i/api/graphql/AbC_123/Bookmarks?features=%7B%22enabled%22%3Atrue%7D";

describe("session and request capture", () => {
  it("parses large X numeric account IDs without truncating", () => {
    expect(parseUserId("u%3D123456789012345678901")).toBe("123456789012345678901");
    expect(parseUserId('"u=4"')).toBe("4");
    expect(parseUserId("%invalid")).toBeNull();
    expect(parseUserId("username=1")).toBeNull();
  });

  it("captures only real X page bookmark requests", () => {
    const headers = [
      { name: "Authorization", value: "Bearer actual" },
      { name: "X-Client-Transaction-Id", value: "exact-transaction-id" },
    ];
    expect(captureRequest(bookmarkUrl, "https://evil.example", headers)).toBeNull();
    expect(captureRequest(bookmarkUrl.replace("x.com", "example.com"), "https://x.com", headers)).toBeNull();
    expect(captureRequest(bookmarkUrl.replace("Bookmarks", "UserTweets"), "https://x.com", headers)).toBeNull();
    const result = captureRequest(bookmarkUrl, "https://x.com", headers);
    expect(result).toMatchObject({
      operation: "Bookmarks",
      queryId: "AbC_123",
      authorization: "Bearer actual",
      transactionId: "exact-transaction-id",
      features: '{"enabled":true}',
    });
  });

  it("gates profile timeline requests behind the armed flag and reads the target user id", () => {
    const headers = [{ name: "Authorization", value: "Bearer actual" }];
    const profileUrl = "https://x.com/i/api/graphql/Pq4VXKQ1bWQ7n1wXsBznqg/UserTweetsAndReplies" +
      "?variables=%7B%22userId%22%3A%2244196397%22%2C%22count%22%3A20%7D" +
      "&features=%7B%22enabled%22%3Atrue%7D";
    expect(captureRequest(profileUrl, "https://x.com", headers)).toBeNull();
    expect(captureRequest(profileUrl, "https://x.com", headers, { profileCaptureArmed: false })).toBeNull();
    const armed = captureRequest(profileUrl, "https://x.com", headers, { profileCaptureArmed: true });
    expect(armed).toMatchObject({
      operation: "UserTweetsAndReplies",
      queryId: "Pq4VXKQ1bWQ7n1wXsBznqg",
      authorization: "Bearer actual",
      targetUserId: "44196397",
      features: '{"enabled":true}',
    });
  });

  it("captures a profile operation without a target when variables are malformed", () => {
    const profileUrl = "https://x.com/i/api/graphql/Pq4VXKQ1bWQ7n1wXsBznqg/UserTweets?variables=not-json";
    const armed = captureRequest(profileUrl, "https://x.com", [], { profileCaptureArmed: true });
    expect(armed).toMatchObject({ operation: "UserTweets", queryId: "Pq4VXKQ1bWQ7n1wXsBznqg" });
    expect(armed?.targetUserId).toBeUndefined();
  });

  it("keeps bookmark capture working while profile capture is disarmed", () => {
    const result = captureRequest(bookmarkUrl, "https://x.com", [], { profileCaptureArmed: false });
    expect(result).toMatchObject({ operation: "Bookmarks", queryId: "AbC_123" });
  });

  it("keeps query IDs separate and rejects malformed feature flags", () => {
    const malformed = captureRequest(bookmarkUrl.replace("%7B%22enabled%22%3Atrue%7D", "%5B%5D"),
      "https://x.com", []);
    expect(malformed?.features).toBeUndefined();
    const original = {
      authorization: "Bearer captured",
      queryIds: { Bookmarks: "first" },
      features: { Bookmarks: '{"ok":true}' },
    };
    const merged = mergeCapture(original, {
      operation: "BookmarkFoldersSlice", queryId: "second",
    });
    expect(merged.queryIds["Bookmarks"]).toBe("first");
    expect(merged.queryIds["BookmarkFoldersSlice"]).toBe("second");
    expect(merged.features["Bookmarks"]).toBe('{"ok":true}');
  });
});
