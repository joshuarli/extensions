import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookmarkSchema } from "../../x-archive-core/src/parser.ts";
import { PROFILE_OPERATIONS } from "../../x-archive-core/src/capture.ts";
import { SqliteProfileStore } from "../src/profile-db.ts";

const ACCOUNT_ID = "424242";
const HANDLE = "fixtureuser";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repoRoot, "x-archive-cli", "src", "cli.ts");

const post = Schema.decodeUnknownSync(BookmarkSchema)({
  tweet_id: "9001",
  sort_index: "9001",
  status: "available",
  created_at: "Sun Nov 16 12:00:00 +0000 2026",
  full_text: "Process boundary fixture post",
  lang: "en",
  source: null,
  conversation_id: "9001",
  in_reply_to_tweet_id: null,
  in_reply_to_user_id: null,
  author: { user_id: ACCOUNT_ID, screen_name: HANDLE, name: "Fixture User", profile_image_url: null, verified: false, followers_count: 1 },
  metrics: { likes: 3, retweets: 0, replies: 0, bookmarks: 0, views: 0 },
  entities: { urls: [], hashtags: [], mentions: [] },
  media: [],
  quoted_tweet: null,
  card: null,
  folder_ids: [],
  observed_at: "2026-11-16T00:00:00.000Z",
});

function runProcess(args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, timeout: 30_000 });
}

describe("x archive CLI process boundary", () => {
  it("returns help, version and usage failures as distinct exit statuses", () => {
    const help = runProcess(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("x download self");

    const version = runProcess(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout).toContain("x-archive-cli 0.1.0");

    for (const args of [["nope"], ["download"], ["download", "self", "--max-media-size=16TB"]]) {
      const bad = runProcess(args);
      expect(bad.status).toBe(2);
      expect(bad.stderr.length).toBeGreaterThan(0);
    }
  });

  it("reports an unreachable CDP endpoint as a failed run with exit status 1", () => {
    const failed = runProcess([
      "download", HANDLE, "--backend=bctl", "--cdp-url=http://127.0.0.1:1", "--export-only", "--no-render",
    ]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("not reachable at http://127.0.0.1:1");
  });
});

interface Fixture {
  readonly stateRoot: string;
  readonly outRoot: string;
  readonly cdpUrl: string;
}

let profileDir: string | undefined;
let chromiumProcess: ChildProcess | undefined;
let setupConnection: Browser | undefined;
let fixture: Fixture | undefined;
let skipReason: string | undefined;

async function discoverPort(directory: string, child: ChildProcess): Promise<number> {
  const portFile = join(directory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").split("\n")[0] ?? "");
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    }
    if (child.exitCode !== null) throw new Error(`Chromium exited with code ${child.exitCode} before opening CDP.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chromium did not write DevToolsActivePort within 10 seconds.");
}

beforeAll(async () => {
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    skipReason = `Chromium is not installed at ${executable}.`;
    return;
  }
  try {
    profileDir = mkdtempSync(join(tmpdir(), "x-cli-process-"));
    chromiumProcess = spawn(executable, [
      "--headless=new", "--no-sandbox", "--no-first-run", "--disable-background-networking",
      "--disable-component-update", "--disable-default-apps", "--disable-sync",
      "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank",
    ], { stdio: "ignore" });
    const port = await discoverPort(profileDir, chromiumProcess);
    if (port === 9222) {
      skipReason = "Chromium chose reserved port 9222; refusing to attach to the owner's Helium.";
      return;
    }
    const stateRoot = mkdtempSync(join(tmpdir(), "x-cli-state-")),
      outRoot = mkdtempSync(join(tmpdir(), "x-cli-downloads-")),
      credentialsDir = join(stateRoot, "x-archive");
    mkdirSync(join(credentialsDir, "state", ACCOUNT_ID), { recursive: true });
    writeFileSync(join(credentialsDir, "credentials.json"), JSON.stringify({
      queryIds: Object.fromEntries(["UserByScreenName", ...PROFILE_OPERATIONS].map((operation) => [operation, "fixture-query-id"])),
      features: {},
      authorization: "Bearer fixture-token",
      cached_at: new Date().toISOString(),
    }));
    writeFileSync(join(credentialsDir, "state", ACCOUNT_ID, "profile-targets.json"), JSON.stringify({
      current: { targetUserId: ACCOUNT_ID, screenName: HANDLE, operation: "UserOriginalsTimeline", capturedAt: new Date().toISOString() },
    }));
    const store = new SqliteProfileStore(join(outRoot, HANDLE, "archive.db"), ACCOUNT_ID);
    await store.savePage([post], ACCOUNT_ID);
    store.close();

    setupConnection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10_000 });
    const context = setupConnection.contexts()[0] ?? await setupConnection.newContext();
    await context.addCookies([
      { name: "twid", value: "u%3D424242", domain: "x.com", path: "/" },
      { name: "ct0", value: "fixture-csrf", domain: "x.com", path: "/" },
    ]);
    fixture = { stateRoot, outRoot, cdpUrl: `http://127.0.0.1:${port}` };
  } catch (error) {
    skipReason = `Chromium CDP endpoint unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}, 30_000);

afterAll(async () => {
  await setupConnection?.close().catch(() => {});
  setupConnection = undefined;
  const child = chromiumProcess;
  chromiumProcess = undefined;
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  const profile = profileDir;
  profileDir = undefined;
  if (profile) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
  const state = fixture?.stateRoot;
  const downloads = fixture?.outRoot;
  fixture = undefined;
  if (state) rmSync(state, { recursive: true, force: true });
  if (downloads) rmSync(downloads, { recursive: true, force: true });
}, 10_000);

describe("x archive CLI complete export over CDP", () => {
  it("exports a seeded profile as JSON, media accounting and rendered HTML", (ctx) => {
    if (skipReason !== undefined || fixture === undefined) {
      ctx.skip(skipReason ?? "CDP endpoint was not prepared.");
      return;
    }
    const env = { ...process.env, X_ARCHIVE_STATE: fixture.stateRoot };
    const result = runProcess([
      "download", HANDLE, "--backend=bctl", `--cdp-url=${fixture.cdpUrl}`,
      `--out=${fixture.outRoot}`, "--export-only",
    ], env);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`${HANDLE} → ${HANDLE}/posts.json`);
    expect(result.stderr).toContain("1 posts");
    expect(result.stderr).toContain("archive.html");

    const folder = join(fixture.outRoot, HANDLE);
    const exported: unknown = JSON.parse(readFileSync(join(folder, "posts.json"), "utf8"));
    expect(exported).toMatchObject({
      posts: [{ tweet_id: "9001", full_text: post.full_text }],
      export_metadata: { tool: "x-profile-posts", user_id: ACCOUNT_ID },
    });
    const debug: unknown = JSON.parse(readFileSync(join(folder, "debug.json"), "utf8"));
    expect(debug).toMatchObject({ tool: "x-profile-posts-debug", account_id: ACCOUNT_ID });
    const html = readFileSync(join(folder, "archive.html"), "utf8");
    expect(html).toContain(post.full_text);
    expect(html).not.toContain("<script src=");
  }, 40_000);
});
