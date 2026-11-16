import { describe, expect, it } from "vitest";
import { captureRequest, mergeCapture, parseProfileScreenName, parseUserId } from "../src/capture.ts";

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
    expect(captureRequest(bookmarkUrl.replace("Bookmarks", "SearchTimeline"), "https://x.com", headers)).toBeNull();
    const profileResult = captureRequest(bookmarkUrl.replace("Bookmarks", "UserTweets"), "https://x.com", headers);
    expect(profileResult).toMatchObject({ operation: "UserTweets", queryId: "AbC_123" });
    const result = captureRequest(bookmarkUrl, "https://x.com", headers);
    expect(result).toMatchObject({
      operation: "Bookmarks",
      queryId: "AbC_123",
      authorization: "Bearer actual",
      transactionId: "exact-transaction-id",
      features: '{"enabled":true}',
    });
  });

  it("captures profile timeline requests and reads the target user id", () => {
    const headers = [{ name: "Authorization", value: "Bearer actual" }];
    const profileUrl = "https://x.com/i/api/graphql/Pq4VXKQ1bWQ7n1wXsBznqg/UserTweetsAndReplies" +
      "?variables=%7B%22userId%22%3A%2244196397%22%2C%22count%22%3A20%7D" +
      "&features=%7B%22enabled%22%3Atrue%7D";
    const captured = captureRequest(profileUrl, "https://x.com", headers);
    expect(captured).toMatchObject({
      operation: "UserTweetsAndReplies",
      queryId: "Pq4VXKQ1bWQ7n1wXsBznqg",
      authorization: "Bearer actual",
      targetUserId: "44196397",
      features: '{"enabled":true}',
    });
  });

  it("captures a profile operation without a target when variables are malformed", () => {
    const profileUrl = "https://x.com/i/api/graphql/Pq4VXKQ1bWQ7n1wXsBznqg/UserTweets?variables=not-json";
    const captured = captureRequest(profileUrl, "https://x.com", []);
    expect(captured).toMatchObject({ operation: "UserTweets", queryId: "Pq4VXKQ1bWQ7n1wXsBznqg" });
    expect(captured?.targetUserId).toBeUndefined();
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

describe("profile URL targeting", () => {
  it("reads the handle from bare profile URLs and known profile subpages", () => {
    expect(parseProfileScreenName("https://x.com/token___garden")).toBe("token___garden");
    expect(parseProfileScreenName("https://x.com/token___garden/")).toBe("token___garden");
    expect(parseProfileScreenName("https://x.com/token___garden/media")).toBe("token___garden");
    expect(parseProfileScreenName("https://x.com/token___garden/with_replies")).toBe("token___garden");
    expect(parseProfileScreenName("https://www.x.com/token___garden")).toBeNull();
  });

  it("rejects non-profile pages and malformed URLs", () => {
    expect(parseProfileScreenName("https://x.com/")).toBeNull();
    expect(parseProfileScreenName("https://x.com/home")).toBeNull();
    expect(parseProfileScreenName("https://x.com/i/bookmarks")).toBeNull();
    expect(parseProfileScreenName("https://x.com/compose/tweet")).toBeNull();
    expect(parseProfileScreenName("https://x.com/token___garden/status/123456")).toBeNull();
    expect(parseProfileScreenName("https://x.com/token___garden/foo/bar")).toBeNull();
    expect(parseProfileScreenName("https://x.com/" + "a".repeat(16))).toBeNull();
    expect(parseProfileScreenName("https://twitter.com/token___garden")).toBeNull();
    expect(parseProfileScreenName("not a url")).toBeNull();
  });

  it("captures the user lookup request", () => {
    const url = "https://x.com/i/api/graphql/AbC_123/UserByScreenName?variables=%7B%22screen_name%22%3A%22token___garden%22%7D&features=%7B%22a%22%3Atrue%7D";
    const captured = captureRequest(url, "https://x.com", []);
    expect(captured).toMatchObject({ operation: "UserByScreenName", queryId: "AbC_123" });
  });
});

describe("collect profile deep link", () => {
  it("carries the profile handle from an x.com profile tab", async () => {
    const { xBookmarksCollectProfileUrl } = await import("../src/background.ts");
    const base = "chrome-extension://abc/features/x-bookmarks/options.html";
    expect(xBookmarksCollectProfileUrl(base, "https://x.com/token___garden"))
      .toBe(base + "?collect=profile&export=1&profile=token___garden");
    expect(xBookmarksCollectProfileUrl(base, "https://x.com/i/bookmarks"))
      .toBe(base + "?collect=profile&export=1");
    expect(xBookmarksCollectProfileUrl(base, undefined))
      .toBe(base + "?collect=profile&export=1");
  });
});
