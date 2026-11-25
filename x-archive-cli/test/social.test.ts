import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELIUM_BACKEND } from "../../lib/cli.ts";
import { credentialsCachePath, writeJsonFile } from "../src/state.ts";
import { downloadSocialLists } from "../src/social.ts";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../src/deps.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/deps.ts")>(),
  captureOperationsFromBrowser: mocks.capture,
}));

const savedState = process.env["X_ARCHIVE_STATE"];
let root: string;
let originalFetch: typeof globalThis.fetch;

function listPage(users: ReadonlyArray<readonly [string, string, string]>) {
  return {
    data: { user: { result: { timeline: { timeline: { instructions: [{
      type: "TimelineAddEntries",
      entries: users.map(([id, handle, name]) => ({
        entryId: "user-" + id,
        content: { entryType: "TimelineTimelineItem", itemContent: { user_results: { result: {
          __typename: "User", rest_id: id, core: { screen_name: handle, name },
        } } } },
      })),
    }] } } } } },
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "x-archive-social-test-"));
  process.env["X_ARCHIVE_STATE"] = root;
  originalFetch = globalThis.fetch;
  mocks.capture.mockReset();
  const page = {
    goto: vi.fn(async () => {}),
    url: () => "https://x.com/alice",
    close: vi.fn(async () => {}),
  };
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
    contexts: () => [{ newPage: async () => page }],
    close: vi.fn(async () => {}),
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  if (savedState === undefined) delete process.env["X_ARCHIVE_STATE"];
  else process.env["X_ARCHIVE_STATE"] = savedState;
  rmSync(root, { recursive: true, force: true });
});

function cacheCredentials(queryIds: Record<string, string>): void {
  mkdirSync(join(root, "x-archive"), { recursive: true });
  writeJsonFile(credentialsCachePath(), {
    authorization: "Bearer token", queryIds, features: {}, cached_at: new Date().toISOString(),
  });
}

function options() {
  return {
    cdpUrl: "http://127.0.0.1:9222",
    outRoot: root,
    signal: new AbortController().signal,
    backend: HELIUM_BACKEND,
    onStatus: () => {},
  };
}

describe("downloadSocialLists", () => {
  it("writes dated following and followers lists from cached credentials, deduplicated by user id", async () => {
    cacheCredentials({ Following: "following-id", Followers: "followers-id" });
    globalThis.fetch = vi.fn(async (input) => response(listPage(String(input).includes("following-id")
      ? [["1", "dave", "Dave"], ["1", "duplicate", "Should be dropped"]]
      : [["2", "eve", "Eve"]])));

    const session = { userId: "42", cookies: [{ name: "ct0", value: "csrf" }] };
    const summary = await downloadSocialLists(session, options());

    expect(summary.folder).toMatch(/^social-\d{4}-\d{2}-\d{2}$/u);
    expect(summary).toMatchObject({ following: 1, followers: 1, reason: "Following:complete, Followers:complete" });
    const folder = join(root, summary.folder);
    const read = (name: string) => JSON.parse(readFileSync(join(folder, name), "utf8")) as {
      account_id: string; count: number; users: Array<Record<string, unknown>>;
    };
    const following = read("following.json");
    expect(following).toMatchObject({
      account_id: "42", count: 1,
      users: [{ user_id: "1", handle: "dave", name: "Dave" }],
    });
    expect(typeof following.users[0]?.["observed_at"]).toBe("string");
    expect(read("followers.json")).toMatchObject({
      account_id: "42", count: 1, users: [{ user_id: "2", handle: "eve", name: "Eve" }],
    });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("re-observes a rejected query and still writes a complete list", async () => {
    cacheCredentials({ Following: "rejected-id", Followers: "followers-id" });
    mocks.capture.mockResolvedValue({
      authorization: "Bearer token", queryIds: { Following: "fresh-id" }, features: {},
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("rejected-id")) return response({ errors: [{ message: "Bad query" }] }, 400);
      return response(listPage(url.includes("fresh-id") || url.includes("followers-id")
        ? [["3", "frank", "Frank"]] : []));
    });

    const session = { userId: "42", cookies: [{ name: "ct0", value: "csrf" }] };
    const summary = await downloadSocialLists(session, options());

    expect(summary).toMatchObject({ following: 1, followers: 1, reason: "Following:complete, Followers:complete" });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(readFileSync(credentialsCachePath(), "utf8")) as { queryIds: Record<string, string> };
    expect(cached.queryIds["Following"]).toBe("fresh-id");
    expect(cached.queryIds["Followers"]).toBe("followers-id");
    const following = JSON.parse(readFileSync(join(root, summary.folder, "following.json"), "utf8")) as {
      users: Array<{ handle: string }>;
    };
    expect(following.users).toEqual([{ user_id: "3", handle: "frank", name: "Frank", observed_at: expect.any(String) }]);
  });
});
