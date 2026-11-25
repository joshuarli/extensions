import { describe, expect, it } from "vitest";
import { BOOKMARK_OPERATIONS, LIKES_OPERATIONS, type Credentials } from "../../x-archive-core/src/capture.ts";
import {
  capturePages,
  credentialCapturePlan,
  hasRequiredCaptures,
  missingCaptures,
  type RequiredCaptures,
} from "../src/deps.ts";

function credentials(queryIds: Record<string, string>, authorization = "Bearer token"): Credentials {
  return { authorization, queryIds, features: {} };
}

describe("capturePages", () => {
  it("opens bookmarks and likes for a self archive", () => {
    const required: RequiredCaptures = [["Bookmarks"], ["Likes"]];
    expect(capturePages(required, undefined)).toEqual([
      "https://x.com/i/history",
      "https://x.com/i/history/likes",
    ]);
  });

  it("maps every exported bookmark and likes operation to a capture page", () => {
    for (const operation of BOOKMARK_OPERATIONS) {
      expect(capturePages([[operation]], undefined)).toContain("https://x.com/i/history");
    }
    for (const operation of LIKES_OPERATIONS) {
      expect(capturePages([[operation]], undefined)).toContain("https://x.com/i/history/likes");
    }
  });

  it("opens the target profile for lookup and timeline operations", () => {
    const required: RequiredCaptures = [["UserByScreenName"], ["UserTweets", "UserOriginalsTimeline"]];
    expect(capturePages(required, "cleanjpg")).toEqual(["https://x.com/cleanjpg"]);
  });

  it("opens the home feed for timeline discovery", () => {
    expect(capturePages([["HomeTimeline"]], undefined)).toEqual(["https://x.com/home"]);
  });

  it("rejects an invalid profile handle", () => {
    expect(() => capturePages([["UserByScreenName"]], "not a handle")).toThrow("valid @handle");
  });
});

describe("hasRequiredCaptures", () => {
  it("requires authorization and at least one operation from every group", () => {
    const required: RequiredCaptures = [["Bookmarks"], ["Likes"]];
    expect(hasRequiredCaptures(credentials({ Bookmarks: "id", Likes: "id" }), required)).toBe(true);
    expect(hasRequiredCaptures(credentials({ Bookmarks: "id" }), required)).toBe(false);
    expect(hasRequiredCaptures(credentials({ Bookmarks: "id", Likes: "id" }, ""), required)).toBe(false);
    expect(missingCaptures(credentials({ Bookmarks: "id" }), required)).toEqual(["Likes"]);
  });
});

describe("credentialCapturePlan", () => {
  const required: RequiredCaptures = [["Bookmarks"], ["Likes"]];
  const pages = ["https://x.com/i/history", "https://x.com/i/history/likes"];

  it("skips capture when the worker already holds every operation", () => {
    const worker = credentials({ Bookmarks: "b", Likes: "l" });
    expect(credentialCapturePlan(required, undefined, null, worker)).toEqual({
      pages, credentials: worker, needsCapture: false,
    });
  });

  it("merges the cache with fresh worker captures instead of discarding either", () => {
    const cached = credentials({ Bookmarks: "b" });
    const worker = credentials({ Likes: "l" });
    const plan = credentialCapturePlan(required, undefined, cached, worker);
    expect(plan.credentials).toMatchObject({ queryIds: { Bookmarks: "b", Likes: "l" } });
    expect(plan.needsCapture).toBe(false);
  });

  it("keeps the cache and still captures when a group is missing", () => {
    const cached = credentials({ Bookmarks: "b" });
    expect(credentialCapturePlan(required, undefined, cached, null)).toMatchObject({
      pages, credentials: cached, needsCapture: true,
    });
    expect(credentialCapturePlan(required, undefined, null, null)).toMatchObject({
      pages, credentials: null, needsCapture: true,
    });
  });

  it("does not capture when nothing is required", () => {
    expect(credentialCapturePlan([], undefined, null, null)).toEqual({
      pages: [], credentials: null, needsCapture: false,
    });
  });

  it("still captures when the merged credentials have no authorization", () => {
    const worker = credentials({ Bookmarks: "b", Likes: "l" }, "");
    expect(credentialCapturePlan(required, undefined, null, worker).needsCapture).toBe(true);
  });

  it("requires a handle before planning profile capture pages", () => {
    expect(() => credentialCapturePlan([["UserByScreenName"]], undefined, null, null)).toThrow("valid @handle");
  });
});
