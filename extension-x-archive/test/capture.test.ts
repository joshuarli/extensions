import { afterEach, describe, expect, it } from "vitest";
import { handleXArchiveRequest } from "../src/background.ts";
import { captureErrorKey, captureRequest, mergeCapture, parseProfileScreenName, parseUserId } from "../src/capture.ts";

const bookmarkUrl = "https://x.com/i/api/graphql/AbC_123/Bookmarks?features=%7B%22enabled%22%3Atrue%7D";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["chrome"];
});

describe("session and request capture", () => {
  it("parses large X numeric account IDs without truncating", () => {
    expect(parseUserId("u%3D123456789012345678901")).toBe("123456789012345678901");
    expect(parseUserId('"u=4"')).toBe("4");
    expect(parseUserId("%invalid")).toBeNull();
    expect(parseUserId("username=1")).toBeNull();
  });

  it("captures the home timeline query for discovery", () => {
    const url = bookmarkUrl.replace("Bookmarks", "HomeTimeline");
    const result = captureRequest(url, "https://x.com", [{ name: "Authorization", value: "Bearer home" }]);
    expect(result).toMatchObject({ operation: "HomeTimeline", queryId: "AbC_123", authorization: "Bearer home" });
  });

  it("captures a POST home timeline with variables and features from the JSON body", () => {
    const url = bookmarkUrl.replace("Bookmarks", "HomeTimeline").split("?")[0] ?? "";
    const body = JSON.stringify({
      variables: { count: 20, cursor: "next" },
      features: { enabled: true },
      fieldToggles: { withPayments: false },
    });
    const result = captureRequest(url, "https://x.com", [{ name: "Authorization", value: "Bearer post" }], "POST", body);
    expect(result).toMatchObject({
      operation: "HomeTimeline",
      method: "POST",
      queryId: "AbC_123",
      authorization: "Bearer post",
      features: '{"enabled":true}',
      fieldToggles: '{"withPayments":false}',
      variables: '{"count":20,"cursor":"next"}',
    });
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

describe("credential capture handler", () => {
  it("stores captured query IDs and authorization under the account-scoped key", async () => {
    const stored: Record<string, unknown> = {};
    (globalThis as Record<string, unknown>)["chrome"] = {
      cookies: { get: async () => ({ value: "u=123" }) },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(stored, items),
        },
      },
    };
    handleXArchiveRequest({
      url: bookmarkUrl,
      initiator: "https://x.com",
      requestHeaders: [{ name: "Authorization", value: "Bearer actual" }],
    } as chrome.webRequest.OnSendHeadersDetails);
    await new Promise((resolve) => setImmediate(resolve));
    expect(stored["x_bookmarks_credentials_123"]).toMatchObject({
      queryIds: { Bookmarks: "AbC_123" },
      authorization: "Bearer actual",
      features: { Bookmarks: '{"enabled":true}' },
    });
  });
});

describe("credential capture queue", () => {
  async function flush(): Promise<void> {
    for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve));
  }

  it("coalesces repeated requests for the same operation", async () => {
    const stored: Record<string, unknown> = {},
      writes: Array<Record<string, unknown>> = [];
    (globalThis as Record<string, unknown>)["chrome"] = {
      cookies: { get: async () => ({ value: "u=123" }) },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => { writes.push(items); Object.assign(stored, items); },
        },
      },
    };
    const request = {
      url: bookmarkUrl,
      initiator: "https://x.com",
      requestHeaders: [{ name: "Authorization", value: "Bearer actual" }],
    } as chrome.webRequest.OnSendHeadersDetails;
    handleXArchiveRequest(request);
    handleXArchiveRequest(request);
    await flush();
    expect(writes.filter((items) => "x_bookmarks_credentials_123" in items)).toHaveLength(1);
  });

  it("persists a capture failure and keeps draining the queue", async () => {
    const stored: Record<string, unknown> = {};
    let credentialWrites = 0;
    (globalThis as Record<string, unknown>)["chrome"] = {
      cookies: { get: async () => ({ value: "u=123" }) },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: stored[key] }),
          set: async (items: Record<string, unknown>) => {
            if ("x_bookmarks_credentials_123" in items) {
              credentialWrites++;
              throw new Error("storage full");
            }
            Object.assign(stored, items);
          },
        },
      },
    };
    handleXArchiveRequest({
      url: bookmarkUrl,
      initiator: "https://x.com",
      requestHeaders: [{ name: "Authorization", value: "Bearer actual" }],
    } as chrome.webRequest.OnSendHeadersDetails);
    await flush();
    expect(stored[captureErrorKey("123")]).toMatchObject({ message: "storage full" });

    handleXArchiveRequest({
      url: bookmarkUrl.replace("Bookmarks", "Likes"),
      initiator: "https://x.com",
      requestHeaders: [],
    } as unknown as chrome.webRequest.OnSendHeadersDetails);
    await flush();
    expect(credentialWrites).toBe(2);
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

describe("fieldToggles capture", () => {
  const headers = [{ name: "Authorization", value: "Bearer actual" }];

  it("captures fieldToggles alongside features", () => {
    const url = "https://x.com/i/api/graphql/ZFKu1DFS63hgrkLzR3Hsdw/UserOriginalsTimeline"
      + "?variables=%7B%22userId%22%3A%2244196397%22%7D"
      + "&features=%7B%22a%22%3Atrue%7D"
      + "&fieldToggles=%7B%22withPayments%22%3Afalse%2C%22withArticlePlainText%22%3Afalse%7D";
    const captured = captureRequest(url, "https://x.com", headers);
    expect(captured).toMatchObject({ operation: "UserOriginalsTimeline" });
    expect(captured?.fieldToggles).toBe('{"withPayments":false,"withArticlePlainText":false}');
  });

  it("rejects malformed fieldToggles but keeps the rest of the capture", () => {
    const url = "https://x.com/i/api/graphql/ZFKu1DFS63hgrkLzR3Hsdw/UserOriginalsTimeline"
      + "?variables=%7B%22userId%22%3A%2244196397%22%7D"
      + "&features=%7B%22a%22%3Atrue%7D"
      + "&fieldToggles=%7B%22withPayments%22%3A%22yes%22%7D";
    const captured = captureRequest(url, "https://x.com", headers);
    expect(captured?.fieldToggles).toBeUndefined();
    expect(captured?.features).toBe('{"a":true}');
  });

  it("merges fieldToggles per operation", () => {
    const url = "https://x.com/i/api/graphql/ZFKu1DFS63hgrkLzR3Hsdw/UserOriginalsTimeline"
      + "?variables=%7B%22userId%22%3A%2244196397%22%7D"
      + "&fieldToggles=%7B%22withPayments%22%3Afalse%7D";
    const captured = captureRequest(url, "https://x.com", headers);
    const merged = mergeCapture({ queryIds: {}, features: {} }, captured!);
    expect(merged.fieldToggles).toEqual({ UserOriginalsTimeline: '{"withPayments":false}' });
  });
});
