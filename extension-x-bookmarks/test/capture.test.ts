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
