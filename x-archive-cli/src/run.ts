import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
import { graphqlRequest, RequestFailure } from "../../x-archive-core/src/api.ts";
import { extractLookupUserId } from "../../x-archive-core/src/collector.ts";
import { renderArchive } from "../../x-archive-core/src/render.ts";
import { PROFILE_OPERATIONS, parseProfileScreenName, type Credentials } from "../../x-archive-core/src/capture.ts";
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
import { downloadPostsMedia, filterCompletedMedia, formatSize } from "./media.ts";
import { downloadSocialLists } from "./social.ts";
import { writeJsonFile } from "./state.ts";
import { syncContextThreads } from "./context.ts";
import { seedFromHelium } from "./seed.ts";
import { createProgressReporter, type ProgressReporter } from "../../lib/progress.ts";

const EXTENSION_VERSION = "x-archive-cli 0.1.0";
const SAFETY_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface RunOptions {
  action: "download" | "collect" | "export";
  outRoot: string;
  render: boolean;
  backend: Backend;
  cdpUrl: string;
  noContext?: boolean;
  maxMediaBytes: number;
  signal: AbortSignal;
}

function runSignal(options: RunOptions): AbortSignal {
  return AbortSignal.any([options.signal, AbortSignal.timeout(SAFETY_TIMEOUT_MS)]);
}

function wasStopped(error: unknown): boolean {
  return error instanceof RequestFailure && error.kind === "stopped";
}

export interface RunSummary {
  folder: string;
  jsonFile: string;
  posts: number;
  mediaTotal: number;
  mediaDownloaded: number;
  mediaFailed: number;
  mediaSkipped: number;
  archiveHtml: string | null;
  collectionReason: string;
  contextPosts: number;
}

class StatusLog {
  private readonly entries: Array<{ text: string; at: string }> = [];
  readonly progress: ProgressReporter;
  constructor(progress: ProgressReporter) {
    this.progress = progress;
  }
  add(text: string): void {
    this.entries.push({ text, at: new Date().toISOString() });
    if (this.entries.length > 40) this.entries.shift();
  }
  say(phase: string, text: string): void {
    this.add(text);
    this.progress.update({ phase, done: 0, total: null, note: text });
  }
  list(): Array<{ text: string; at: string }> {
    return [...this.entries];
  }
}

export function progressLogger(progress: ProgressReporter, label: string): ({ posts, pages }: { posts: number; pages: number }) => void {
  return ({ posts, pages }) => {
    progress.update({ phase: label, done: posts, total: null, note: pages + (pages === 1 ? " page" : " pages") });
  };
}

async function resolveTargetUserId(
  session: XSession,
  credentials: Credentials,
  screenName: string,
  status: StatusLog,
  signal: AbortSignal,
): Promise<string> {
  const cached = await buildDeps(session, credentials).readProfileTarget(session.userId);
  if (cached?.screenName === screenName && cached.targetUserId) return cached.targetUserId;
  const queryId = credentials.queryIds["UserByScreenName"];
  if (!queryId) {
    throw new Error("The UserByScreenName lookup was never captured. Open https://x.com/" + screenName + " in Helium once, then retry.");
  }
  const authorization = credentials.authorization;
  if (!authorization) throw new Error("Captured credentials carry no authorization header. Open x.com in Helium once, then retry.");
  status.say("session", "Resolving @" + screenName + " to an X user id…");
  void queryId;
  const body = await Effect.runPromise(
    graphqlRequest(session.userId, credentials, "UserByScreenName", { screen_name: screenName }, AbortSignal.any([signal, AbortSignal.timeout(30_000)]), async () => cookieSession(session)),
  ).catch((cause: unknown) => {
    if (wasStopped(cause)) throw cause;
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
  const limitText = formatSize(options.maxMediaBytes);
  status.say("media", "Media: " + jobsAll.jobs.length + " items (" + missingFromArchive + " missing or unavailable); fetching " + jobs.length
    + (options.maxMediaBytes > 0 ? ". Skipping files over " + limitText + "." : ". No size limit."));
  const media = await downloadPostsMedia(jobs, {
    session,
    folder: outDir,
    maxBytes: options.maxMediaBytes,
    signal: options.signal,
    onProgress: ({ downloaded, failed, skipped, total }) => {
      const done = downloaded + failed + skipped;
      if (done % 25 === 0 || done === total) {
        status.progress.update({ phase: "media", done, total, note: downloaded + " downloaded"
          + (failed ? " · " + failed + " failed" : "")
          + (skipped ? " · " + skipped + " skipped" : "") });
      }
    },
  });
  if (media.skipped.length > 0) {
    status.add("Skipped " + media.skipped.length + " media file(s) over " + limitText + "; nothing was written to disk for them.");
  }
  if (media.stopped) {
    status.add("Media download stopped; saved media files are kept.");
  }
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
    status.say("rendering", "Rendering archive.html…");
    try {
      const rendered = await renderArchive({ folder: outDir });
      archiveHtml = rendered.output;
      status.say("rendering", "Rendered archive.html (" + rendered.posts + " posts).");
    } catch (error) {
      status.add("Rendering failed: " + (error instanceof Error ? error.message : String(error)) + "; the JSON archive is still complete.");
    }
  }
  return {
    folder,
    jsonFile,
    posts: posts.length,
    mediaTotal: jobsAll.jobs.length,
    mediaDownloaded,
    mediaFailed: media.failed.length + missingFromArchive,
    mediaSkipped: media.skipped.length,
    archiveHtml,
    collectionReason,
    contextPosts: input.contextPosts,
  };
}

async function downloadBookmarks(session: XSession, credentials: Credentials, options: RunOptions, status: StatusLog): Promise<RunSummary> {
  const store = new FsBookmarksStore(session.userId);
  const deps = buildDeps(session, credentials);
  if (options.action !== "export") {
    status.say("collecting", "Scanning bookmarks (existing saved posts are retained)…");
    try {
      await collect({
        userId: session.userId,
        store,
        deps,
        signal: runSignal(options),
        report: (text) => status.add(text),
        onProgress: progressLogger(status.progress, "bookmarks"),
      });
    } catch (error) {
      if (!wasStopped(error)) throw error;
      status.say("stopping", "Stopped; exporting what was saved.");
    }
    if (options.action === "collect") {
      const state = await store.loadState();
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, mediaSkipped: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: 0 };
    }
  }
  const state = await store.loadState();
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local bookmarks archive is empty. Run `x download self` without --export-only.");
  }
  status.say("export", "Assembling bookmarks.json…");
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
    status.say("collecting", "Scanning likes (existing saved posts are retained)…");
    try {
      await collectLikes({
        userId: session.userId,
        store,
        deps,
        signal: runSignal(options),
        report: (text) => status.add(text),
        onProgress: progressLogger(status.progress, "likes"),
      });
    } catch (error) {
      if (!wasStopped(error)) throw error;
      status.say("stopping", "Stopped; exporting what was saved.");
    }
    if (options.action === "collect") {
      const state = await store.loadState();
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, mediaSkipped: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: 0 };
    }
  }
  const state = await store.loadState();
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local likes archive is empty. Run `x download self` without --export-only.");
  }
  status.say("export", "Assembling likes.json…");
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
  const progress = createProgressReporter();
  const status = new StatusLog(progress);
  status.say("session", "Connecting to " + options.cdpUrl + "…");
  const session = await readBrowserSession(options.cdpUrl, options.backend);
  status.say("session", "Reading captured X credentials…");
  const credentials = await readCapturedCredentials(session, options.cdpUrl, options.backend, {
    required: [["UserByScreenName"], PROFILE_OPERATIONS],
    screenName,
    onStatus: (text) => status.say("session", text),
    signal: options.signal,
  });
  const targetUserId = await resolveTargetUserId(session, credentials, screenName, status, options.signal);
  const profileDir = screenName.toLowerCase();
  const outDir = join(options.outRoot, profileDir);
  mkdirSync(outDir, { recursive: true });
  const store = new SqliteProfileStore(profileDbPath(outDir), targetUserId);
  status.say("session", "Checking legacy extension archives…");
  if (options.backend.kind === "bctl") {
    status.say("session", "Seeding needs the Helium extension, which the bctl appliance does not have; continuing with the local store.");
  } else {
    try {
      const seed = await seedFromHelium(session, options.cdpUrl, { onlyProfileTarget: targetUserId, profileStore: store });
      const profile = seed.profiles[0];
      if (profile) status.say("session", "Seeded from Helium: " + profile.records + " saved posts" + (profile.already ? " (already up to date)" : " (merged)") + ".");
    } catch (error) {
      status.say("session", "Helium seeding unavailable: " + (error instanceof Error ? error.message : String(error)) + ". Continuing with the local store.");
    }
  }
  const deps = buildDeps(session, credentials);
  if (options.action !== "export") {
    status.say("collecting", "Scanning @" + screenName + " (existing saved posts are retained)…");
    try {
      await collectProfile({
        userId: session.userId,
        store,
        deps,
        signal: runSignal(options),
        report: (text) => status.add(text),
        onProgress: progressLogger(status.progress, screenName),
      });
    } catch (error) {
      if (!wasStopped(error)) throw error;
      status.say("stopping", "Stopped; exporting what was saved.");
    }
    if (options.signal.aborted) {
      status.say("stopping", "Skipping thread context after interrupt.");
    } else if (options.noContext) {
      status.say("collecting", "Skipping thread context fetch (--no-context).");
    } else {
      status.say("collecting", "Fetching thread context — ancestors of archived replies (text only, no media)…");
      try {
        const context = await syncContextThreads({
          store,
          targetUserId,
          signal: runSignal(options),
          report: (text) => status.add(text),
        });
        status.say("collecting", "Context: " + context.stored + " posts stored (" + context.fetched + " pages fetched, " + context.failed + " failed, " + context.unreachable + " unreachable).");
      } catch (error) {
        status.say("collecting", "Context backfill failed: " + (error instanceof Error ? error.message : String(error)) + ". Re-running `x download " + screenName + "` resumes it; the archive exports with what it has.");
      }
    }
    if (options.action === "collect") {
      const state = await store.loadState(targetUserId);
      progress.finish();
      return { folder: "-", jsonFile: "-", posts: (await store.allRecords()).length,
        mediaTotal: 0, mediaDownloaded: 0, mediaFailed: 0, mediaSkipped: 0, archiveHtml: null,
        collectionReason: state?.reason ?? "unknown", contextPosts: await store.contextCount() };
    }
  }
  const state = await store.loadState(targetUserId);
  const raw = await store.allRecords();
  if (options.action === "export" && raw.length === 0) {
    throw new Error("The local archive for @" + screenName + " under " + outDir + " is empty. Run `x download " + screenName + "` first.");
  }
  const rawContext = await store.allContextRecords();
  status.say("export", "Assembling posts.json…");
  const archive = assembleProfileArchive(raw, state, session.userId, targetUserId, rawContext);
  (archive.export_metadata as Record<string, unknown>)["requested_profile"] = screenName;
  const folder = profileDir;
  mkdirSync(outDir, { recursive: true });
  writeJsonFile(join(outDir, "posts.json"), archive, 0o644);
  const summary = await finishExport({
    session, credentials, options, status, outDir, folder,
    jsonFile: "posts.json",
    posts: archive.posts,
    mediaFailedInArchive: 0,
    contextPosts: rawContext.length,
    debugTool: "x-profile-posts-debug",
    archiveMeta: archive.export_metadata,
    collectionReason: String(((archive.export_metadata as Record<string, unknown>)["collection"] as Record<string, unknown> | undefined)?.["reason"] ?? "unknown"),
  });
  progress.finish();
  return summary;
}

export async function downloadSelf(options: RunOptions): Promise<RunSummary[]> {
  const progress = createProgressReporter();
  const status = new StatusLog(progress);
  status.say("session", "Connecting to " + options.cdpUrl + "…");
  const session = await readBrowserSession(options.cdpUrl, options.backend);
  status.say("session", "Reading captured X credentials…");
  const credentials = await readCapturedCredentials(session, options.cdpUrl, options.backend, {
    required: [["Bookmarks"], ["Likes"]],
    onStatus: (text) => status.say("session", text),
    signal: options.signal,
  });
  status.say("session", "Checking legacy extension archives…");
  if (options.backend.kind === "bctl") {
    status.say("session", "Seeding needs the Helium extension, which the bctl appliance does not have; continuing with the local store.");
  } else {
    try {
      const seed = await seedFromHelium(session, options.cdpUrl);
      status.say("session", "Seeded from Helium: bookmarks " + seed.bookmarks.records + " posts"
        + (seed.bookmarks.already ? " (already up to date)" : " (merged)")
        + ", likes " + seed.likes.records + " posts"
        + (seed.likes.already ? " (already up to date)" : " (merged)")
        + (seed.profiles.length ? ", " + seed.profiles.length + " profile archive(s)" : "") + ".");
    } catch (error) {
      status.say("session", "Helium seeding unavailable: " + (error instanceof Error ? error.message : String(error)) + ". Continuing with the local store.");
    }
  }
  const summaries: RunSummary[] = [];
  if (credentials.queryIds["Bookmarks"] && !options.signal.aborted) {
    summaries.push(await downloadBookmarks(session, credentials, options, status));
  } else if (!options.signal.aborted) {
    status.say("collecting", "Skipping bookmarks: never captured (open https://x.com/i/history in Helium once).");
  }
  if (credentials.queryIds["Likes"] && !options.signal.aborted) {
    summaries.push(await downloadLikes(session, credentials, options, status));
  } else if (!options.signal.aborted) {
    status.say("collecting", "Skipping likes: never captured (open https://x.com/i/history/likes in Helium once).");
  }
  if (!options.signal.aborted) {
    try {
      const social = await downloadSocialLists(session, {
        cdpUrl: options.cdpUrl,
        outRoot: options.outRoot,
        signal: options.signal,
        backend: options.backend,
        onStatus: (text) => status.say("session", text),
      });
      status.say("social", "Saved " + social.following + " following and " + social.followers
        + " followers to " + social.folder + "/ (" + social.reason + ").");
    } catch (error) {
      status.say("social", "Following/followers capture failed: "
        + (error instanceof Error ? error.message : String(error)));
    }
  }
  progress.finish();
  if (summaries.length === 0 && !options.signal.aborted) {
    throw new Error("Nothing captured yet. Open https://x.com/i/history and https://x.com/i/history/likes in Helium once, then retry.");
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
    + (summary.mediaSkipped ? " (" + summary.mediaSkipped + " skipped: too large)" : "")
    + (summary.contextPosts ? " · context " + summary.contextPosts + " posts" : "")
    + " · collection: " + summary.collectionReason
    + html + "\n",
  );
}
