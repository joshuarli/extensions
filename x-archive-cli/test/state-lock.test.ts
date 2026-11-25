import { expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStoreLock } from "../src/state.ts";

it("reclaims a lock abandoned by a crashed writer", async () => {
  const root = mkdtempSync(join(tmpdir(), "x-archive-lock-"));
  try {
    const store = join(root, "store.json"),
      lock = store + ".lock";
    writeFileSync(lock, JSON.stringify({ pid: 1, token: "crashed" }));
    const abandonedAt = new Date(Date.now() - 31_000);
    utimesSync(lock, abandonedAt, abandonedAt);
    let ran = false;
    await withStoreLock(store, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
