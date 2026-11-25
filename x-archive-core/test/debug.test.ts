import { describe, expect, it } from "vitest";
import { buildDebugReport, credentialsSummary } from "../src/debug.ts";
import type { Credentials } from "../src/capture.ts";

const credentials: Credentials = {
  authorization: "Bearer super-secret-token",
  clientUuid: "uuid-secret",
  transactionId: "txn-secret",
  queryIds: { Bookmarks: "q-bookmarks", UserOriginalsTimeline: "q-timeline" },
  features: { Bookmarks: '{"enabled":true}' },
};

describe("debug report", () => {
  it("summarizes credentials without emitting secret values", () => {
    const summary = credentialsSummary(credentials);
    expect(summary["Bookmarks"]?.authorization_present).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("super-secret-token");
  });

  it("builds a report without authorization, uuid, or transaction material", () => {
    const report = buildDebugReport(
      {
        accountId: "123",
        requestedProfile: "jack",
        exportFolder: "jack-2026-11-16",
        extensionVersion: "0.1.0",
        archive: { profile: null, collection: { posts: "complete", reason: "complete" }, stats: null },
        media: null,
        statusLog: [{ text: "Exported 10 posts", at: "2026-11-16T00:00:00.000Z" }],
        failures: ["Rendering failed: bad template"],
      },
      {
        credentials,
        storedTarget: null,
        lastCapture: null,
        unmatchedOps: [{ operation: "SomeTimeline" }],
        lastError: null,
        statusLog: [],
      },
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("uuid-secret");
    expect(text).not.toContain("txn-secret");
    expect(report.credentials["UserOriginalsTimeline"]).toMatchObject({
      queryId: "q-timeline",
      authorization_present: true,
    });
    expect(report.status_log.map((entry) => entry.text)).toEqual(["Exported 10 posts"]);
    expect(report.failures).toEqual(["Rendering failed: bad template"]);
  });
});
