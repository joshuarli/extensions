import { describe, expect, it } from "vitest";
import { buildMediaManifest, type MediaJob } from "../src/media.ts";

const job: MediaJob = { tweet_id: "1", index: 0, kind: "photo", url: "https://pbs.twimg.com/media/a.jpg", filename: "1_0.jpg" };

describe("buildMediaManifest", () => {
  it("records download status, bytes and hash for every job", () => {
    const manifest = buildMediaManifest([job], {
      total: 1,
      downloaded: 1,
      failed: [],
      skipped: [],
      downloadedDetails: [{ filename: "1_0.jpg", bytes: 42, sha256: "abc" }],
      stopped: false,
    });
    expect(manifest).toEqual([{ tweet_id: "1", index: 0, filename: "1_0.jpg", url: job.url,
      status: "downloaded", bytes: 42, sha256: "abc" }]);
  });

  it("marks skipped, failed and already-present files", () => {
    const result = {
      total: 3,
      downloaded: 0,
      failed: [{ filename: "1_1.jpg", error: "HTTP 500" }],
      skipped: [{ filename: "1_2.jpg", bytes: 99 }],
      downloadedDetails: [],
      stopped: false,
    };
    const jobs: MediaJob[] = [
      { ...job, index: 1, filename: "1_1.jpg" },
      { ...job, index: 2, filename: "1_2.jpg" },
      { ...job, index: 3, filename: "1_3.jpg" },
    ];
    expect(buildMediaManifest(jobs, result).map((entry) => entry.status)).toEqual(["failed", "skipped", "present"]);
  });
});
