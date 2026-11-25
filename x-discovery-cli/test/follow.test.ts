import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../lib/test/tmp.ts";
import type { XClient } from "../../x-client-core/src/client.ts";
import { followingFromMutation } from "../../x-client-core/src/follow.ts";
import { appendFinds, loadProject, readLedger, type FindRecord } from "../../x-discovery-core/src/index.ts";
import { followHandles } from "../src/follow.ts";

let directory: string;
let ledgerPath: string;

const record: FindRecord = {
  tweet_id: "1",
  author_id: "900",
  author_handle: "dave",
  source_url: "https://x.com/dave/status/1",
  topic_score: 5,
  links: [],
  note: "a film",
  discovered_at: "2026-11-25T00:00:00.000Z",
  status: "followed",
};

function lookup(following: boolean | undefined): unknown {
  return { data: { user: { result: {
    rest_id: "900",
    relationship_perspectives: following === undefined ? {} : { following },
  } } } };
}

function client(following: boolean | undefined): XClient {
  return {
    accountId: "172",
    feed: "home-for-you",
    operations: ["UserByScreenName"],
    request: vi.fn(async () => lookup(following)),
    follow: vi.fn(async () => ({ userId: "900", followed: true, verified: true, status: 200 })),
    homePage: vi.fn(async () => { throw new Error("unused"); }),
  };
}

beforeEach(() => {
  directory = makeTempDir("x-discovery-follow-");
  ledgerPath = join(directory, "finds.jsonl");
  appendFinds(ledgerPath, [record]);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("follow state", () => {
  it("follows when X says the account is not followed despite a stale ledger status", async () => {
    const fake = client(false);
    const result = await followHandles({
      handles: ["dave"],
      project: loadProject("movies"),
      ledgerPath,
      client: fake,
      signal: new AbortController().signal,
    });
    expect(result.followed).toEqual(["dave"]);
    expect(fake.follow).toHaveBeenCalledOnce();
    expect(readLedger(ledgerPath)[0]).toMatchObject({ status: "followed" });
  });

  it("skips an account X reports as already followed", async () => {
    const fake = client(true);
    const result = await followHandles({
      handles: ["dave"],
      project: loadProject("movies"),
      ledgerPath,
      client: fake,
      signal: new AbortController().signal,
    });
    expect(result.alreadyFollowing).toEqual(["dave"]);
    expect(fake.follow).not.toHaveBeenCalled();
  });

  it("reads confirmation from the follow response", () => {
    expect(followingFromMutation({ data: { user: { following: true } } })).toBe(true);
    expect(followingFromMutation({ data: { user: { following: false } } })).toBe(false);
    expect(followingFromMutation({})).toBeNull();
  });
});
