import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookmarkSchema } from "../../x-archive-core/src/parser.ts";
import { HELIUM_BACKEND } from "../../lib/cli.ts";
import { FsBookmarksStore, FsLikesStore } from "../src/fs-store.ts";
import { credentialsCachePath, writeJsonFile } from "../src/state.ts";
import { downloadProfile, downloadSelf, type RunOptions } from "../src/run.ts";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  credentials: vi.fn(),
  seed: vi.fn(),
  social: vi.fn(),
  renderFail: false,
}));

vi.mock("../src/deps.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/deps.ts")>(),
  readBrowserSession: mocks.session,
  readCapturedCredentials: mocks.credentials,
}));
vi.mock("../src/seed.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/seed.ts")>(),
  seedFromHelium: mocks.seed,
}));
vi.mock("../src/social.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/social.ts")>(),
  downloadSocialLists: mocks.social,
}));
vi.mock("../../x-archive-core/src/render.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../x-archive-core/src/render.ts")>();
  return {
    ...actual,
    renderArchive: (options: Parameters<typeof actual.renderArchive>[0]) => {
      if (mocks.renderFail) throw new Error("render exploded");
      return actual.renderArchive(options);
    },
  };
});

const savedState = process.env["X_ARCHIVE_STATE"];
let stateRoot: string;
let outRoot: string;

const post = (id: string, text: string) => Schema.decodeUnknownSync(BookmarkSchema)({
  tweet_id: id,
  sort_index: id,
  status: "available",
  created_at: "Sun Nov 16 12:00:00 +0000 2026",
  full_text: text,
  lang: "en",
  source: null,
  conversation_id: id,
  in_reply_to_tweet_id: null,
  in_reply_to_user_id: null,
  author: { user_id: "42", screen_name: "alice", name: "Alice", profile_image_url: null, verified: false, followers_count: 1 },
  metrics: { likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
  entities: { urls: [], hashtags: [], mentions: [] },
  media: [],
  quoted_tweet: null,
  card: null,
  folder_ids: [],
  observed_at: "2026-11-16T00:00:00.000Z",
});

function options(): RunOptions {
  return {
    action: "export",
    outRoot,
    render: true,
    backend: HELIUM_BACKEND,
    cdpUrl: "http://127.0.0.1:9222",
    offline: true,
    maxMediaBytes: 16 * 1024 * 1024,
    signal: new AbortController().signal,
  };
}

beforeEach(async () => {
  stateRoot = mkdtempSync(join(tmpdir(), "x-archive-run-state-"));
  outRoot = mkdtempSync(join(tmpdir(), "x-archive-run-out-"));
  process.env["X_ARCHIVE_STATE"] = stateRoot;
  mocks.renderFail = false;
  mocks.session.mockReset().mockResolvedValue({ userId: "42", cookies: [] });
  mocks.credentials.mockReset().mockResolvedValue({
    authorization: "Bearer token",
    queryIds: { Bookmarks: "b", Likes: "l", Following: "f", Followers: "fo", UserByScreenName: "lookup" },
    features: {},
  });
  mocks.seed.mockReset().mockResolvedValue({
    bookmarks: { records: 0 }, likes: { records: 0 }, profiles: [],
  });
  mocks.social.mockReset().mockResolvedValue({
    folder: "social-2026-11-25", following: 2, followers: 3, reason: "Following:complete, Followers:complete",
  });
  mkdirSync(join(stateRoot, "x-archive"), { recursive: true });
  writeJsonFile(credentialsCachePath(), {
    authorization: "Bearer token",
    queryIds: { Bookmarks: "b", Likes: "l", Following: "f", Followers: "fo", UserByScreenName: "lookup" },
    features: {},
    cached_at: new Date().toISOString(),
  });
  await new FsBookmarksStore("42").savePage([post("100", "A saved bookmark")]);
  await new FsLikesStore("42").savePage([post("200", "A liked post")]);
});

afterEach(() => {
  if (savedState === undefined) delete process.env["X_ARCHIVE_STATE"];
  else process.env["X_ARCHIVE_STATE"] = savedState;
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(outRoot, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("downloadSelf export orchestration", () => {
  it("writes complete bookmarks and likes folders with manifests, debug reports and HTML", async () => {
    const summaries = await downloadSelf(options());

    expect(summaries).toHaveLength(2);
    const [bookmarks, likes] = summaries;
    if (!bookmarks || !likes) throw new Error("expected bookmarks and likes summaries");
    expect(bookmarks).toMatchObject({
      jsonFile: "bookmarks.json", posts: 1, mediaTotal: 0, mediaDownloaded: 0,
      mediaFailed: 0, mediaSkipped: 0, failures: [],
    });
    expect(likes).toMatchObject({
      jsonFile: "likes.json", posts: 1, mediaTotal: 0, mediaFailed: 0, failures: [],
    });

    const bookmarkFolder = join(outRoot, bookmarks.folder);
    const exported = readJson(join(bookmarkFolder, "bookmarks.json"));
    expect((exported["bookmarks"] as Array<{ full_text: string }>)[0]?.full_text).toBe("A saved bookmark");
    expect(exported["media_manifest"]).toEqual([]);
    expect(readJson(join(bookmarkFolder, "debug.json"))).toMatchObject({
      tool: "x-bookmarks-debug", account_id: "42", export_folder: bookmarks.folder, failures: [],
    });
    expect(readFileSync(join(bookmarkFolder, "archive.html"), "utf8")).toContain("A saved bookmark");

    const likeFolder = join(outRoot, likes.folder);
    expect((readJson(join(likeFolder, "likes.json"))["likes"] as Array<{ full_text: string }>)[0]?.full_text)
      .toBe("A liked post");
    expect(readJson(join(likeFolder, "debug.json"))).toMatchObject({ tool: "x-likes-debug", account_id: "42" });
    expect(readFileSync(join(likeFolder, "archive.html"), "utf8")).toContain("A liked post");
  });

  it("records a social-list failure on every summary without losing the exported archives", async () => {
    mocks.social.mockRejectedValue(new Error("no social credentials"));

    const summaries = await downloadSelf(options());

    expect(summaries).toHaveLength(2);
    for (const summary of summaries) {
      expect(summary.failures).toEqual(["Following/followers capture failed: no social credentials"]);
    }
    const first = summaries[0];
    if (!first) throw new Error("expected a bookmarks summary");
    expect((readJson(join(outRoot, first.folder, "bookmarks.json"))["bookmarks"] as unknown[])).toHaveLength(1);
  });

  it("keeps a complete JSON export when rendering fails", async () => {
    mocks.renderFail = true;

    const summaries = await downloadSelf(options());
    const first = summaries[0];
    if (!first) throw new Error("expected a bookmarks summary");

    expect(first).toMatchObject({ archiveHtml: null, posts: 1 });
    expect(first.failures).toEqual(["Rendering failed: render exploded"]);
    const folder = join(outRoot, first.folder);
    expect((readJson(join(folder, "bookmarks.json"))["bookmarks"] as unknown[])).toHaveLength(1);
    expect(readJson(join(folder, "debug.json"))["failures"]).toEqual(["Rendering failed: render exploded"]);
  });
});

describe("downloadProfile export orchestration", () => {
  it("fails loudly when the local profile archive is empty", async () => {
    const targetDir = join(stateRoot, "x-archive", "state", "42");
    mkdirSync(targetDir, { recursive: true });
    writeJsonFile(join(targetDir, "profile-targets.json"), {
      current: { targetUserId: "999", screenName: "nobody", operation: "UserOriginalsTimeline", capturedAt: "2026-11-25T00:00:00Z" },
    });
    await expect(downloadProfile("@nobody", options())).rejects.toThrow(
      /The local archive for @nobody under .* is empty\. Run `x download nobody` first\./u,
    );
  });
});
