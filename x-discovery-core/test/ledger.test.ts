import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../lib/test/tmp.ts";
import { appendFinds, markFollowed, readLedger, type FindRecord } from "../src/ledger.ts";

let directory: string;
let path: string;

function record(id: string): FindRecord {
  return {
    tweet_id: id,
    author_id: "900",
    author_handle: "dave",
    source_url: "https://x.com/dave/status/" + id,
    topic_score: 4,
    links: [],
    note: "a film",
    discovered_at: "2026-11-25T00:00:00.000Z",
    status: "seen",
  };
}

beforeEach(() => {
  directory = makeTempDir("x-discovery-ledger-");
  path = join(directory, "finds.jsonl");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("find ledger", () => {
  it("appends once and records follows atomically", () => {
    expect(appendFinds(path, [record("1"), record("1")])).toEqual({ added: 1, duplicates: 1 });
    expect(markFollowed(path, ["900"])).toBe(1);
    expect(readLedger(path)[0]).toMatchObject({ status: "followed" });
    expect(readLedger(path)[0]?.followed_at).toBeTruthy();
  });

  it("clears a stale followed status when X reports an unfollow", async () => {
    appendFinds(path, [record("1")]);
    markFollowed(path, ["900"]);
    const { setFollowState } = await import("../src/ledger.ts");
    expect(setFollowState(path, ["900"], "seen")).toBe(1);
    expect(readLedger(path)[0]).toMatchObject({ status: "seen" });
    expect(readLedger(path)[0]?.followed_at).toBeUndefined();
  });

  it("reports a torn record with its line number instead of a raw syntax error", () => {
    writeFileSync(path, '{"tweet_id":\n');
    expect(() => readLedger(path)).toThrow("Corrupt find record at line 1");
  });
});
