import { describe, expect, it } from "vitest";
import { BOOKMARK_OPERATIONS, LIKES_OPERATIONS, type Credentials } from "../../x-archive-core/src/capture.ts";
import {
  capturePages,
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
