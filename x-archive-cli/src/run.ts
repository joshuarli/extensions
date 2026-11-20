import { mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  collect,
  collectLikes,
  collectProfile,
} from "../../x-archive-core/src/collector.ts";
import {
  assembleBookmarkArchive,
  assembleLikesArchive,
  assembleProfileArchive,
} from "../../x-archive-core/src/storage.ts";
import { collectMediaJobs } from "../../x-archive-core/src/media.ts";
import {
  bookmarksFolderName,
  likesFolderName,
} from "../../x-archive-core/src/export-paths.ts";
import { buildDebugReport } from "../../x-archive-core/src/debug.ts";
import { Effect } from "effect";
import { graphqlRequest } from "../../x-archive-core/src/api.ts";
import { extractLookupUserId } from "../../x-archive-core/src/collector.ts";
import { parseProfileScreenName, type Credentials } from "../../x-archive-core/src/capture.ts";
import { FsBookmarksStore, FsLikesStore } from "./fs-store.ts";
import { SqliteProfileStore, profileDbPath } from "./profile-db.ts";
import type { Backend } from "./backend.ts";
import {
  buildDeps,
  cookieSession,
  readCapturedCredentials,
  readBrowserSession,
  type XSession,
} from "./deps.ts";
import { downloadPostsMedia, filterCompletedMedia } from "./media.ts";
import { writeJsonFile } from "./state.ts";
import { syncContextThreads } from "./context.ts";
import { seedFromHelium } from "./seed.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDER_TOOL = join(REPO_ROOT, "extension-x-bookmarks", "tools", "render_archive.py");
const EXTENSION_VERSION = "x-archive-cli 0.1.0";
const SAFETY_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface RunOptions {
  action: "download" | "collect" | "export";
  outRoot: string;
  render: boolean;
  backend: Backend;
  cdpUrl: string;
  noContext?: boolean;
}

export interface RunSummary {
  folder: string;
  jsonFile: string;
  posts: number;
  mediaTotal: number;
  mediaDownloaded: number;
  mediaFailed: number;
  archiveHtml: string | null;
  collectionReason: string;
  contextPosts: number;
}

class StatusLog {
  private readonly entries: Array<{ text: string; at: string }> = [];
  add(text: string): void {
    process.stderr.write(text + "\n");
    this.entries.push({ text, at: new Date().toISOString() });
    if (this.entries.length > 40) this.entries.shift();
  }
  list(): Array<{ text: string; at: string }> {
    return [...this.entries];
  }
}

function progressLogger(label: string): ({ posts, pages }: { posts: number; pages: number }) => void {
  let last = 0;
  return ({ posts, pages }) => {
    if (posts >= last + 500 || posts < last) {
      process.stderr.write("  " + label + ": " + posts + " posts, " + pages + " pages\n");
      last = posts;
    }
  };
}

async function resolveTargetUserId(
  session: XSession,
  credentials: Credentials,
  screenName: string,
  status: StatusLog,
): Promise<string> {
  const cached = await buildDeps(session, credentials).readProfileTarget(session.userId);
  if (cached?.screenName === screenName && cached.targetUserId) return cached.targetUserId;
  const queryId = credentials.queryIds["UserByScreenName"];
  if (!queryId) {
    throw new Error("The UserByScreenName lookup was never captured. Open https://x.com/" + screenName + " in Helium once with the extension loaded.");
  }
  const authorization = credentials.authorization;
  if (!authorization) throw new Error("Captured credentials carry no authorization header. Open x.com in Helium once with the extension loaded.");
  status.add("Resolving @" + screenName + " to an X user id…");
  void queryId;
  const body = await Effect.runPromise(
    graphqlRequest(session.userId, credentials, "UserByScreenName", { screen_name: screenName }, AbortSignal.timeout(30_000), async () => cookieSession(session)),
  ).catch((cause: unknown) => {
    throw new Error("X could not resolve @" + screenName + ": " + (cause instanceof Error ? cause.message : String(cause)));
  });
  const restId = extractLookupUserId(body);
  if (!restId) {
    throw new Error("X could not resolve @" + screenName + " to a user id. Check the handle and reopen the profile in Helium.");
  }
  const target = {
    targetUserId: restId,
    screenName,
    operation: (credentials.queryIds["UserOriginalsTimeline"] ? "UserOriginalsTimeline"
      : credentials.queryIds["UserRepliesTimeline"] ? "UserRepliesTimeline"
      : "UserTweetsAndReplies") as "UserOriginalsTimeline" | "UserRepliesTimeline" | "UserTweetsAndReplies",
    capturedAt: new Date().toISOString(),
  };
  await buildDeps(session, credentials).writeProfileTarget(session.userId, target);
  return restId;
}

async function renderArchive(folder: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn("python3", [RENDER_TOOL, folder], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", () => resolvePromise(false));
  });
}

interface FinishExportInput {
  session: XSession;
  credentials: Credentials;
  options: RunOptions;
  status: StatusLog;
  outDir: string;
  folder: string;
  jsonFile: string;
  posts: unknown[];
  mediaFailedInArchive: number;
  debugTool: string;
  archiveMeta: unknown;
  collectionReason: string;
  contextPosts: number;
}

async function finishExport(input: FinishExportInput): Promise<RunSummary> {
  const { session, credentials, options, status, outDir, folder, jsonFile, posts, mediaFailedInArchive, debugTool, archiveMeta, collectionReason } = input;
  mkdirSync(outDir, { recursive: true });
  const jobsAll = collectMediaJobs(posts);
  const missingFromArchive = jobsAll.missing + mediaFailedInArchive;
  const jobs = filterCompletedMedia(jobsAll.jobs, outDir);
  status.add("Media: " + jobsAll.jobs.length + " items (" + missingFromArchive + " missing or unavailable); fetching " + jobs.length + ".");
  const media = await downloadPostsMedia(jobs, {
    session,
    folder: outDir,
    onProgress: ({ downloaded, failed, total }) => {
      if (downloaded % 25 === 0 || downloaded + failed === total) {
        process.stderr.write("  media: " + (downloaded + failed) + "/" + total + " (" + downloaded + " done)\n");
      }
    },
  });
  const mediaDownloaded = jobsAll.jobs.length - jobs.length + media.downloaded;
  const report = buildDebugReport(
    {
      accountId: session.userId,
      requestedProfile: undefined,
      exportFolder: folder,
      extensionVersion: EXTENSION_VERSION,
      archive: archiveMeta,
      media,
      reportName: debugTool,
      statusLog: status.list(),
    },
    {
      credentials,
      storedTarget: null,
      lastCapture: null,
      unmatchedOps: [],
      lastError: null,
      statusLog: status.list(),
    },
  );
  writeJsonFile(join(outDir, "debug.json"), report, 0o644);
  let archiveHtml: string | null = null;
  if (options.render) {
    if (await renderArchive(outDir)) archiveHtml = join(outDir, "archive.html");
    else status.add("Rendering failed; the JSON archive is still complete.");
  }
  return {
    folder,
    jsonFile,
    posts: posts.length,
    mediaTotal: jobsAll.jobs.length,
    mediaDownloaded,
    mediaFailed: media.failed.length + missingFromArchive,
    archiveHtml,
    collectionReason,
    contextPosts: input.contextPosts,
  };
}

async function downloadBookmarks(session: XSession, credentials: Credentials, options: RunOptions, status: StatusLog): Promise<RunSummary> {
  const store = new FsBookmarksStore(session.userId);
  const deps = buildDeps(session, credentials);
  if (options.action !== "export") {
    status.add("Scanning bookmarks (existing saved posts are retained)…");
    await collect({
      userId: session.userId,
      store,
      deps,
      signal: AbortSignal.timeout(SAFETY_TIMEOUT_MS),
      report: (text) => status.add(text),
      onProgress: progressLogger("bookmarks"),
    });
    if (options.action === "collect") {
      const state = await store.loadState();
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: 0 };
    }
  }
  const state = await store.loadState();
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local bookmarks archive is empty and Helium could not be read. Run the extension's Collect bookmarks once, or `x download self` without --export-only.");
  }
  const archive = assembleBookmarkArchive(raw, await store.allFolders(), state, session.userId);
  const folder = bookmarksFolderName();
  const outDir = join(options.outRoot, folder);
  mkdirSync(outDir, { recursive: true });
  writeJsonFile(join(outDir, "bookmarks.json"), archive, 0o644);
  return finishExport({
    session, credentials, options, status, outDir, folder,
    jsonFile: "bookmarks.json",
    posts: archive.bookmarks,
    mediaFailedInArchive: 0,
    contextPosts: 0,
    debugTool: "x-bookmarks-debug",
    archiveMeta: archive.export_metadata,
    collectionReason: (archive.export_metadata as Record<string, unknown>)["collection"]
      ? String(((archive.export_metadata as Record<string, unknown>)["collection"] as Record<string, unknown>)["reason"])
      : "unknown",
  });
}

async function downloadLikes(session: XSession, credentials: Credentials, options: RunOptions, status: StatusLog): Promise<RunSummary> {
  const store = new FsLikesStore(session.userId);
  const deps = buildDeps(session, credentials);
  if (options.action !== "export") {
    status.add("Scanning likes (existing saved posts are retained)…");
    await collectLikes({
      userId: session.userId,
      store,
      deps,
      signal: AbortSignal.timeout(SAFETY_TIMEOUT_MS),
      report: (text) => status.add(text),
      onProgress: progressLogger("likes"),
    });
    if (options.action === "collect") {
      const state = await store.loadState();
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: 0 };
    }
  }
  const state = await store.loadState();
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local likes archive is empty and Helium could not be read. Run the extension's Collect likes once, or `x download self` without --export-only.");
  }
  const archive = assembleLikesArchive(raw, state, session.userId);
  const folder = likesFolderName();
  const outDir = join(options.outRoot, folder);
  mkdirSync(outDir, { recursive: true });
  writeJsonFile(join(outDir, "likes.json"), archive, 0o644);
  return finishExport({
    session, credentials, options, status, outDir, folder,
    jsonFile: "likes.json",
    posts: archive.likes,
    mediaFailedInArchive: 0,
    contextPosts: 0,
    debugTool: "x-likes-debug",
    archiveMeta: archive.export_metadata,
    collectionReason: String(((archive.export_metadata as Record<string, unknown>)["collection"] as Record<string, unknown> | undefined)?.["reason"] ?? "unknown"),
  });
}

export async function downloadProfile(handle: string, options: RunOptions): Promise<RunSummary> {
  const input = handle.replace(/^@/u, "");
  const screenName = parseProfileScreenName(input.startsWith("http") ? input : "https://x.com/" + input);
  if (!screenName) {
    throw new Error("Could not read a profile handle from \"" + handle + "\". Pass @handle, a bare handle, or an x.com profile URL.");
  }
  const session = await readBrowserSession(options.cdpUrl, options.backend);
  const credentials = await readCapturedCredentials(session, options.cdpUrl, options.backend);
  const status = new StatusLog();
  const targetUserId = await resolveTargetUserId(session, credentials, screenName, status);
  const profileDir = screenName.toLowerCase();
  const outDir = join(options.outRoot, profileDir);
  mkdirSync(outDir, { recursive: true });
  const store = new SqliteProfileStore(profileDbPath(outDir), targetUserId);
  if (options.backend.kind === "bctl") {
    status.add("Seeding needs the Helium extension, which the bctl appliance does not have; continuing with the local store.");
  } else {
    try {
      const seed = await seedFromHelium(session, options.cdpUrl, { onlyProfileTarget: targetUserId, profileStore: store });
      const profile = seed.profiles[0];
      if (profile) status.add("Seeded from Helium: " + profile.records + " saved posts" + (profile.already ? " (already up to date)" : " (merged)") + ".");
    } catch (error) {
      status.add("Helium seeding unavailable: " + (error instanceof Error ? error.message : String(error)) + ". Continuing with the local store.");
    }
  }
  const deps = buildDeps(session, credentials);
  if (options.action !== "export") {
    status.add("Scanning @" + screenName + " (existing saved posts are retained)…");
    await collectProfile({
      userId: session.userId,
      store,
      deps,
      signal: AbortSignal.timeout(SAFETY_TIMEOUT_MS),
      report: (text) => status.add(text),
      onProgress: progressLogger(screenName),
    });
    if (options.noContext) {
      status.add("Skipping thread context fetch (--no-context).");
    } else {
      status.add("Fetching thread context — ancestors of archived replies (text only, no media)…");
      try {
        const context = await syncContextThreads({
          store,
          targetUserId,
          signal: AbortSignal.timeout(SAFETY_TIMEOUT_MS),
          report: (text) => status.add(text),
        });
        status.add("Context: " + context.stored + " posts stored (" + context.fetched + " pages fetched, " + context.failed + " failed, " + context.unreachable + " unreachable).");
      } catch (error) {
        status.add("Context backfill failed: " + (error instanceof Error ? error.message : String(error)) + ". Re-running `x download " + screenName + "` resumes it; the archive exports with what it has.");
      }
    }
    if (options.action === "collect") {
      const state = await store.loadState(targetUserId);
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: await store.contextCount() };
    }
  }
  const state = await store.loadState(targetUserId);
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local archive for @" + screenName + " under " + outDir + " is empty. Run `x download " + screenName + "` first.");
  }
  const rawContext = await store.allContextRecords();
  const archive = assembleProfileArchive(raw, state, session.userId, targetUserId, rawContext);
  const folder = profileDir;
  mkdirSync(outDir, { recursive: true });
  writeJsonFile(join(outDir, "posts.json"), archive, 0o644);
  return finishExport({
    session, credentials, options, status, outDir, folder,
    jsonFile: "posts.json",
    posts: archive.posts,
    mediaFailedInArchive: 0,
    contextPosts: rawContext.length,
    debugTool: "x-profile-posts-debug",
    archiveMeta: archive.export_metadata,
    collectionReason: String(((archive.export_metadata as Record<string, unknown>)["collection"] as Record<string, unknown> | undefined)?.["reason"] ?? "unknown"),
  });
}

export async function downloadSelf(options: RunOptions): Promise<RunSummary[]> {
  const session = await readBrowserSession(options.cdpUrl, options.backend);
  const credentials = await readCapturedCredentials(session, options.cdpUrl, options.backend);
  const status = new StatusLog();
  if (options.backend.kind === "bctl") {
    status.add("Seeding needs the Helium extension, which the bctl appliance does not have; continuing with the local store.");
  } else {
    try {
      const seed = await seedFromHelium(session, options.cdpUrl);
      status.add("Seeded from Helium: bookmarks " + seed.bookmarks.records + " posts"
        + (seed.bookmarks.already ? " (already up to date)" : " (merged)")
        + ", likes " + seed.likes.records + " posts"
        + (seed.likes.already ? " (already up to date)" : " (merged)")
        + (seed.profiles.length ? ", " + seed.profiles.length + " profile archive(s)" : "") + ".");
    } catch (error) {
      status.add("Helium seeding unavailable: " + (error instanceof Error ? error.message : String(error)) + ". Continuing with the local store.");
    }
  }
  const summaries: RunSummary[] = [];
  if (credentials.queryIds["Bookmarks"]) {
    summaries.push(await downloadBookmarks(session, credentials, options, status));
  } else {
    status.add("Skipping bookmarks: never captured (open https://x.com/i/history in Helium once).");
  }
  if (credentials.queryIds["Likes"]) {
    summaries.push(await downloadLikes(session, credentials, options, status));
  } else {
    status.add("Skipping likes: never captured (open https://x.com/i/history/likes in Helium once).");
  }
  if (summaries.length === 0) {
    throw new Error("Nothing captured yet. Open https://x.com/i/history and https://x.com/i/history/likes in Helium once with the extension loaded.");
  }
  return summaries;
}

export function printSummary(label: string, summary: RunSummary): void {
  const html = summary.archiveHtml ? " · archive.html" : "";
  process.stderr.write(
    label + " → " + summary.folder + "/" + summary.jsonFile
    + " · " + summary.posts + " posts"
    + " · media " + summary.mediaDownloaded + "/" + summary.mediaTotal + " downloaded"
    + (summary.mediaFailed ? " (" + summary.mediaFailed + " unavailable)" : "")
    + (summary.contextPosts ? " · context " + summary.contextPosts + " posts" : "")
    + " · collection: " + summary.collectionReason
    + html + "\n",
  );
}
