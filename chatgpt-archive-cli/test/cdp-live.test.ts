import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createChatgptArchive } from "../../chatgpt-archive-core/src/index.ts";
import type { DownloadOptions } from "../src/args.ts";
import { connectChatgpt, createPageTransport, type ChatgptConnection } from "../src/browser.ts";
import { runDownload } from "../src/download.ts";
import { sha256Hex, splitLines } from "../src/storage.ts";
import { createMemoryFs, createReporter } from "./fakes.ts";

const ACCOUNT_ID = "user-cdp-live";
const ACCESS_TOKEN = "fixture-access-token";
const IDS = ["conv-cdp-1", "conv-cdp-2"] as const;
const NOW = Date.parse("2026-11-22T10:30:00Z");
const OUT_ROOT = "/chatgpt-cdp-live-downloads";
const DAY_DIR = join(OUT_ROOT, `chatgpt-${new Date(NOW).toISOString().slice(0, 10)}`);
const RECORDS = join(DAY_DIR, "records.jsonl");
const MANIFEST = join(DAY_DIR, "manifest.json");

interface FixtureState {
  readonly recordRequests: string[];
}

interface FixtureResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

const ROWS = IDS.map((id, index) => ({
  id,
  title: `Fixture conversation ${index + 1}`,
  create_time: "2026-11-20T08:00:00.000Z",
  update_time: `2026-11-2${index + 1}T09:00:00.000Z`,
  is_archived: false,
}));

function json(value: unknown): FixtureResponse {
  return { status: 200, contentType: "application/json", body: JSON.stringify(value) };
}

function fixture(pathname: string, params: URLSearchParams, state: FixtureState): FixtureResponse | null {
  if (pathname === "/") {
    return { status: 200, contentType: "text/html", body: "<!doctype html><title>chatgpt fixture</title>" };
  }
  if (pathname === "/api/auth/session") {
    return json({ user: { id: ACCOUNT_ID }, accessToken: ACCESS_TOKEN });
  }
  if (pathname === "/backend-api/conversations") {
    return params.get("is_archived") === "true"
      ? json({ items: [], total: 0 })
      : json({ items: ROWS, total: ROWS.length });
  }
  const prefix = "/backend-api/conversation/";
  if (pathname.startsWith(prefix)) {
    const id = decodeURIComponent(pathname.slice(prefix.length));
    if ((IDS as readonly string[]).includes(id)) {
      state.recordRequests.push(id);
      return json({
        id,
        title: `Fixture conversation ${IDS.indexOf(id as typeof IDS[number]) + 1}`,
        create_time: "2026-11-20T08:00:00.000Z",
        update_time: "2026-11-21T09:00:00.000Z",
        mapping: {},
      });
    }
  }
  return null;
}

async function installFixtures(context: BrowserContext, state: FixtureState): Promise<void> {
  await context.route("**/*", (route) => route.abort());
  await context.route("https://chatgpt.com/**", (route) => {
    const url = new URL(route.request().url());
    const response = fixture(url.pathname, url.searchParams, state);
    return route.fulfill(response ?? { status: 404, contentType: "application/json", body: "{}" });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function discoverPort(profileDir: string, process: ChildProcess): Promise<number> {
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").split("\n")[0] ?? "");
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    }
    if (process.exitCode !== null) throw new Error(`Chromium exited with code ${process.exitCode} before opening CDP.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chromium did not write DevToolsActivePort within 10 seconds.");
}

let profileDir: string | undefined;
let chromiumProcess: ChildProcess | undefined;
let setupConnection: Browser | undefined;
let connection: ChatgptConnection | undefined;
let cdpUrl: string | undefined;
let fixtureState: FixtureState | undefined;
let skipReason: string | undefined;

beforeAll(async () => {
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    skipReason = `Chromium is not installed at ${executable}.`;
    return;
  }
  try {
    profileDir = mkdtempSync(join(tmpdir(), "chatgpt-cdp-live-"));
    chromiumProcess = spawn(executable, [
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-features=Translate,OptimizationHints,MediaRouter",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ], { stdio: "ignore" });
    const port = await discoverPort(profileDir, chromiumProcess);
    if (port === 9222) {
      skipReason = "Chromium chose reserved port 9222; refusing to attach to the owner's Helium.";
      return;
    }
    cdpUrl = `http://127.0.0.1:${port}`;
    setupConnection = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
    const context = setupConnection.contexts()[0] ?? await setupConnection.newContext();
    fixtureState = { recordRequests: [] };
    await installFixtures(context, fixtureState);
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  } catch (error) {
    skipReason = `Chromium CDP endpoint unavailable: ${errorMessage(error)}`;
  }
}, 15_000);

afterEach(async () => {
  await connection?.close().catch(() => {});
  await setupConnection?.close().catch(() => {});
  connection = undefined;
  setupConnection = undefined;

  const process = chromiumProcess;
  chromiumProcess = undefined;
  if (process !== undefined && process.exitCode === null) {
    process.kill("SIGKILL");
    await Promise.race([
      new Promise<void>((resolve) => process.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }

  if (profileDir !== undefined) {
    const dir = profileDir;
    profileDir = undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (lastError !== undefined) throw lastError;
  }
  cdpUrl = undefined;
  fixtureState = undefined;
}, 10_000);

function options(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    since: null,
    until: null,
    sinceMs: null,
    untilMs: null,
    timeField: "updated",
    outRoot: OUT_ROOT,
    includeArchived: false,
    limit: null,
    noMedia: true,
    backend: undefined,
    session: undefined,
    cdpUrl: undefined,
    ...overrides,
  };
}

describe("live CDP archive", () => {
  it("archives routed chatgpt.com fixtures over CDP and skips saved ids on resume", async (ctx) => {
    if (skipReason !== undefined) {
      ctx.skip(skipReason);
      return;
    }
    if (cdpUrl === undefined || fixtureState === undefined) {
      ctx.skip("CDP endpoint was not prepared.");
      return;
    }

    connection = await connectChatgpt(cdpUrl);
    const transport = createPageTransport(connection);
    const archive = createChatgptArchive({
      transport,
      sleep: async () => {},
      now: () => NOW,
      requestGapMs: 0,
    });

    const session = await archive.session();
    expect(session).toEqual({ accountId: ACCOUNT_ID, accessToken: ACCESS_TOKEN });

    const fs = createMemoryFs();
    const firstReporter = createReporter();
    const first = await runDownload(
      { options: options({ limit: 1, cdpUrl }) },
      { archive, fs, reporter: firstReporter, now: () => NOW },
    );

    expect(first).toMatchObject({ written: 1, skipped: 0, total: 1, archived: 0, outputDir: DAY_DIR });
    const firstRecords = fs.files.get(RECORDS) ?? "";
    expect(splitLines(firstRecords).map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([IDS[0]]);
    expect(firstRecords).not.toContain(IDS[1]);
    expect(firstReporter.reports[0]?.phase).toBe("session");
    expect(firstReporter.reports[0]?.note).toBe(`account ${ACCOUNT_ID}`);
    expect(firstReporter.reports.map((report) => report.phase)).toEqual(expect.arrayContaining([
      "session",
      "list active",
      "list archived",
      "records",
      "manifest",
    ]));

    const secondReporter = createReporter();
    const second = await runDownload(
      { options: options({ cdpUrl }) },
      { archive, fs, reporter: secondReporter, now: () => NOW },
    );

    expect(second).toMatchObject({ written: 1, skipped: 1, total: 2, archived: 0, outputDir: DAY_DIR });
    const secondRecords = fs.files.get(RECORDS) ?? "";
    expect(secondRecords.startsWith(firstRecords)).toBe(true);
    expect(splitLines(secondRecords).map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([...IDS]);
    expect(fixtureState.recordRequests.filter((id) => id === IDS[0])).toHaveLength(1);
    expect(fixtureState.recordRequests.filter((id) => id === IDS[1])).toHaveLength(1);

    const manifest = JSON.parse(fs.files.get(MANIFEST) ?? "") as {
      accountId: string;
      total: number;
      sha256OfRecords: string;
    };
    expect(manifest.accountId).toBe(ACCOUNT_ID);
    expect(manifest.total).toBe(2);
    expect(manifest.sha256OfRecords).toBe(await sha256Hex(secondRecords));
    expect(secondReporter.reports.map((report) => report.phase)).toContain("manifest");
  }, 30_000);
});
