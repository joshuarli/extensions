import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startXArchiveRun } from "../src/archive-engine.ts";

const stored: Record<string, unknown> = {};

function stubChrome(): void {
  (globalThis as Record<string, unknown>)["chrome"] = {
    cookies: {
      get: async ({ name }: { name: string }) => (name === "twid" ? { value: "u=123" } : { value: "x" }),
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(stored, items),
        remove: async (key: string) => { delete stored[key]; },
      },
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["chrome"];
  for (const key of Object.keys(stored)) delete stored[key];
});

describe("interrupted archive runs", () => {
  it("starts a run instead of wedging forever on a stale collecting record", async () => {
    stubChrome();
    stored["x_archive_run"] = {
      id: "interrupted-run",
      job: "profile",
      phase: "collecting",
      detail: "stuck from a crashed browser session",
      posts: 42,
      pages: 10,
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };
    const result = await startXArchiveRun("export", "profile", { targetUserId: "44196397" });
    expect(result.ok).toBe(true);
    expect(stored["x_archive_run"]).toMatchObject({ job: "profile", phase: "exporting" });
    expect(stored["x_archive_run"]).not.toMatchObject({ id: "interrupted-run" });
    await vi.waitFor(() => {
      const run = stored["x_archive_run"] as { phase?: string };
      expect(["done", "error"]).toContain(run?.phase);
    }, { timeout: 5000 });
  });

  it("refuses to start while a fresh run is still in flight", async () => {
    stubChrome();
    stored["x_archive_run"] = {
      id: "live-run",
      job: "profile",
      phase: "collecting",
      detail: "working",
      posts: 1,
      pages: 1,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await startXArchiveRun("export", "profile", { targetUserId: "44196397" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already in progress");
    expect(stored["x_archive_run"]).toMatchObject({ id: "live-run", phase: "collecting" });
  });
});
