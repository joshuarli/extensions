import { afterEach, describe, expect, it } from "vitest";
import { buildDebugReport, credentialsSummary, readLastError, recordLastError } from "../src/debug.ts";
import { type Credentials } from "../src/capture.ts";

const stored: Record<string, unknown> = {};

function stubChrome(): void {
  (globalThis as Record<string, unknown>)["chrome"] = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(stored, items),
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["chrome"];
  for (const key of Object.keys(stored)) delete stored[key];
});

const credentials: Credentials = {
  authorization: "Bearer super-secret-token",
  clientUuid: "uuid-secret",
  transactionId: "txn-secret",
  queryIds: { Bookmarks: "q-bookmarks", UserOriginalsTimeline: "q-timeline" },
  features: { Bookmarks: '{"enabled":true}' },
};

describe("debug report", () => {
  it("never emits authorization, uuid, or transaction material", async () => {
    stubChrome();
    stored["x_bookmarks_credentials_123"] = credentials;
    stored["x_profile_target_123"] = { targetUserId: "44196397", operation: "UserTweets", capturedAt: "2026-11-16T00:00:00.000Z" };
    stored["x_profile_unmatched_ops"] = [
      { operation: "SidebarUserRecommendations" },
      { operation: "SomeTimeline", variables: '{"userId":"1"}' },
    ];
    await recordLastError("profile", "X request failed: boom");
    const report = await buildDebugReport({
      accountId: "123",
      requestedProfile: "jack",
      exportFolder: "x-profile-jack-2026-11-16",
      extensionVersion: "1.2.3",
      archive: {
        profile: { screen_name: null },
        collection: { posts: "not_checked", reason: "not_scanned" },
        stats: { total_posts: 0 },
      },
      media: null,
      statusLog: [{ text: "Export failed: boom", at: "2026-11-16T00:00:01.000Z" }],
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("uuid-secret");
    expect(text).not.toContain("txn-secret");
    expect(report.credentials["UserOriginalsTimeline"]).toMatchObject({
      queryId: "q-timeline",
      authorization_present: true,
    });
    expect(report.unmatched_operations.map((entry) => entry.operation))
      .toEqual(["SidebarUserRecommendations", "SomeTimeline"]);
    expect(report.last_error).toMatchObject({ label: "profile", message: "X request failed: boom" });
    expect(await readLastError()).toMatchObject({ label: "profile" });
  });

  it("summarizes credentials without emitting secret values", () => {
    const summary = credentialsSummary(credentials);
    expect(summary["Bookmarks"]?.authorization_present).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("super-secret-token");
  });
});
