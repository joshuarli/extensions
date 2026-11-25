import { describe, expect, it } from "vitest";
import type { ProgressReport, ProgressReporter } from "../../lib/progress.ts";
import { progressLogger } from "../src/run.ts";

function reporter(): ProgressReporter & { reports: ProgressReport[] } {
  const reports: ProgressReport[] = [];
  return {
    reports,
    update(report) { reports.push(report); },
    finish() {},
  };
}

describe("collection progress", () => {
  it("reports every page instead of waiting for a large jump in posts", () => {
    const progress = reporter();
    const report = progressLogger(progress, "alice");
    report({ posts: 16, pages: 1 });
    report({ posts: 29, pages: 2 });
    report({ posts: 42, pages: 3 });
    expect(progress.reports).toEqual([
      { phase: "alice", done: 16, total: null, note: "1 page" },
      { phase: "alice", done: 29, total: null, note: "2 pages" },
      { phase: "alice", done: 42, total: null, note: "3 pages" },
    ]);
  });

  it("reports a new page even when the post count does not advance", () => {
    const progress = reporter();
    const report = progressLogger(progress, "alice");
    report({ posts: 16, pages: 1 });
    report({ posts: 16, pages: 2 });
    expect(progress.reports.map((entry) => entry.note)).toEqual(["1 page", "2 pages"]);
  });
});
