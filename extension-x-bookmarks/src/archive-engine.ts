import { collect, collectProfile } from "./collector.ts";
import {
  clearArchiveStop,
  patchArchiveRun,
  readArchiveRun,
  readArchiveStop,
  writeArchiveRun,
  writeArchiveStop,
  type ArchiveRunAction,
  type ArchiveRunJob,
  type ArchiveRunRecord,
} from "./archive-run.ts";import {
  assembleProfileArchive,
  listProfileStates,
  openProfileArchive,
} from "./profile-storage.ts";
import { assembleArchive, openArchive } from "./storage.ts";
import { collectMediaJobs } from "./media.ts";
import {
  bookmarksFolderName,
  downloadDebugJson,
  downloadFolderFile,
  downloadPostsJson,
  downloadPostsMedia,
  exportFolderName,
} from "./profile-export.ts";
import { buildDebugReport, clearLastError, clearStatusLog, recordLastError, recordStatusEntry } from "./debug.ts";
import { currentUserId, readProfileTarget } from "./capture.ts";

function log(text: string): void {
  void recordStatusEntry(text);
}

function friendlyAbort(message: string): boolean {
  return /stopped by user/iu.test(message);
}

interface RunExtras {
  screenName?: string;
  targetUserId?: string;
}

async function runProfile(
  account: string,
  action: ArchiveRunAction,
  extras: RunExtras,
  signal: AbortSignal,
  report: (message: string) => void,
  onProgress: (snapshot: { posts: number; pages: number }) => void,
): Promise<string> {
  const profileDb = await openProfileArchive(account);
  try {
    let targetUserId = action === "export" ? extras.targetUserId : undefined;
    if (action !== "export") {
      report("Collecting the profile timeline — existing saved posts are retained.");
      await collectProfile({ userId: account, db: profileDb, signal, report, onProgress },
        extras.screenName ? { screenName: extras.screenName } : undefined);
      if (action === "collect") {
        return "Profile collection finished. Saved pages are retained — re-running only downloads what's new.";
      }
      targetUserId = (await readProfileTarget(account))?.targetUserId ?? undefined;
    }
    if (!targetUserId) {
      const stored = await readProfileTarget(account);
      targetUserId = extras.targetUserId
        ?? stored?.targetUserId
        ?? (await listProfileStates(profileDb))[0]?.targetUserId
        ?? undefined;
    }
    if (!targetUserId) {
      throw new Error("No profile archive to download yet — collect one first.");
    }
    let folder: string | null = null;
    try {
      await patchArchiveRun({ phase: "exporting", detail: "Preparing posts.json" });
      const archive = await assembleProfileArchive(profileDb, account, targetUserId);
      const stored = await readProfileTarget(account);
      folder = exportFolderName(archive.profile.screen_name ?? stored?.screenName, targetUserId);
      const jobs = collectMediaJobs(archive.posts);
      const jsonFilename = await downloadPostsJson(JSON.stringify(archive, null, 2), folder);
      report("Saved posts.json. Downloading " + jobs.jobs.length + " media files to " + folder + "/media/…");
      await patchArchiveRun({ mediaDownloaded: 0, mediaTotal: jobs.jobs.length });
      const mediaResult = await downloadPostsMedia(jobs.jobs, folder, {
        report,
        signal,
        onProgress: (progress) => void patchArchiveRun({
          mediaDownloaded: progress.downloaded,
          mediaTotal: progress.total,
          detail: "Downloading media " + progress.downloaded + "/" + progress.total,
        }),
      });
      const failedCount = mediaResult.failed.length;
      let debugNote = "";
      try {
        const debugReport = await buildDebugReport({
          accountId: account,
          requestedProfile: extras.screenName,
          exportFolder: folder,
          extensionVersion: chrome.runtime.getManifest().version,
          archive: archive.export_metadata,
          media: mediaResult,
        });
        const debugFilename = await downloadDebugJson(JSON.stringify(debugReport, null, 2), folder);
        debugNote = " Debug report: " + debugFilename + ".";
      } catch (debugError) {
        debugNote = " Debug report failed: " + (debugError instanceof Error ? debugError.message : String(debugError)) + ".";
      }
      return "Exported " + archive.posts.length + " posts to " + jsonFilename +
        " with " + mediaResult.downloaded + "/" + mediaResult.total + " media files" +
        (failedCount ? " (" + failedCount + " failed — re-run to retry)" : "") +
        (mediaResult.stopped ? " — stopped early" : "") + "." + debugNote;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void recordLastError("profile export", message);
      if (folder) {
        try {
          const debugReport = await buildDebugReport({
            accountId: account,
            requestedProfile: extras.screenName,
            exportFolder: folder,
            extensionVersion: chrome.runtime.getManifest().version,
            archive: { profile: null, collection: { posts: "error", reason: message }, stats: null },
            media: null,
          });
          await downloadDebugJson(JSON.stringify(debugReport, null, 2), folder);
        } catch { /* The export error is the one that matters. */ }
      }
      throw error;
    }
  } finally {
    profileDb.close();
  }
}

async function runBookmarks(
  account: string,
  action: ArchiveRunAction,
  signal: AbortSignal,
  report: (message: string) => void,
  onProgress: (snapshot: { posts: number; pages: number }) => void,
): Promise<string> {
  const db = await openArchive(account);
  try {
    if (action !== "export") {
      report("Scanning all bookmarks. Existing saved bookmarks are retained.");
      await collect({ userId: account, db, signal, report, onProgress });
      if (action === "collect") {
        return "Bookmark collection finished. Saved bookmarks are retained.";
      }
    }
    let folder: string | null = null;
    try {
      await patchArchiveRun({ phase: "exporting", detail: "Preparing bookmarks.json" });
      const data = await assembleArchive(db, account);
      folder = bookmarksFolderName();
      const jobs = collectMediaJobs(data.bookmarks);
      const jsonFilename = await downloadFolderFile(JSON.stringify(data, null, 2), folder, "bookmarks.json");
      report("Saved bookmarks.json. Downloading " + jobs.jobs.length + " media files to " + folder + "/media/…");
      await patchArchiveRun({ mediaDownloaded: 0, mediaTotal: jobs.jobs.length });
      const mediaResult = await downloadPostsMedia(jobs.jobs, folder, {
        report,
        signal,
        onProgress: (progress) => void patchArchiveRun({
          mediaDownloaded: progress.downloaded,
          mediaTotal: progress.total,
          detail: "Downloading media " + progress.downloaded + "/" + progress.total,
        }),
      });
      const failedCount = mediaResult.failed.length;
      let debugNote = "";
      try {
        const debugReport = await buildDebugReport({
          accountId: account,
          requestedProfile: undefined,
          exportFolder: folder,
          extensionVersion: chrome.runtime.getManifest().version,
          archive: data.export_metadata,
          media: mediaResult,
          reportName: "x-bookmarks-debug",
        });
        const debugFilename = await downloadDebugJson(JSON.stringify(debugReport, null, 2), folder);
        debugNote = " Debug report: " + debugFilename + ".";
      } catch (debugError) {
        debugNote = " Debug report failed: " + (debugError instanceof Error ? debugError.message : String(debugError)) + ".";
      }
      return "Exported " + data.bookmarks.length + " bookmarks to " + jsonFilename +
        " with " + mediaResult.downloaded + "/" + mediaResult.total + " media files" +
        (failedCount ? " (" + failedCount + " failed — re-run to retry)" : "") +
        (mediaResult.stopped ? " — stopped early" : "") + "." + debugNote;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void recordLastError("bookmarks export", message);
      if (folder) {
        try {
          const debugReport = await buildDebugReport({
            accountId: account,
            requestedProfile: undefined,
            exportFolder: folder,
            extensionVersion: chrome.runtime.getManifest().version,
            archive: { profile: null, collection: { bookmarks: "error", folders: "not_checked", reason: message }, stats: null },
            media: null,
            reportName: "x-bookmarks-debug",
          });
          await downloadDebugJson(JSON.stringify(debugReport, null, 2), folder);
        } catch { /* The export error is the one that matters. */ }
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

async function run(record: ArchiveRunRecord, action: ArchiveRunAction, extras: RunExtras): Promise<void> {
  const controller = new AbortController();
  const stopTimer = setInterval(() => {
    void readArchiveStop().then((stop) => {
      if (stop?.id === record.id) controller.abort();
    });
  }, 400);
  const report = (text: string) => {
    log(text);
    void patchArchiveRun({ detail: text });
  };
  const onProgress = (snapshot: { posts: number; pages: number }) => {
    void patchArchiveRun({ posts: snapshot.posts, pages: snapshot.pages });
  };
  try {
    const account = await currentUserId();
    if (!account) {
      throw new Error("Not signed in to X in this browser. Sign in to x.com and try again.");
    }
    const summary = record.job === "profile"
      ? await runProfile(account, action, extras, controller.signal, report, onProgress)
      : await runBookmarks(account, action, controller.signal, report, onProgress);
    await clearLastError();
    await clearStatusLog();
    await patchArchiveRun({ phase: "done", detail: summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (friendlyAbort(message)) {
      await patchArchiveRun({ phase: "done", detail: "Stopped by user — saved pages are retained." });
    } else {
      void recordLastError(record.job, message);
      await patchArchiveRun({ phase: "error", detail: message, error: message });
    }
  } finally {
    clearInterval(stopTimer);
    await clearArchiveStop();
  }
}

export const STALE_RUN_MS = 8 * 60 * 1000;

export function runHeartbeatIsStale(record: Pick<ArchiveRunRecord, "updatedAt">, now: number): boolean {
  const updated = Date.parse(record.updatedAt);
  return !Number.isFinite(updated) || now - updated >= STALE_RUN_MS;
}

export async function startXArchiveRun(
  action: ArchiveRunAction,
  job: ArchiveRunJob,
  extras: RunExtras = {},
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const running = await readArchiveRun();
  if (running && (running.phase === "collecting" || running.phase === "exporting")) {
    if (!runHeartbeatIsStale(running, Date.now())) {
      return { ok: false, error: "Another archive run is already in progress." };
    }
    await patchArchiveRun({ phase: "error",
      detail: "The previous run appears to have been interrupted; starting a new run.",
      error: "The previous run was interrupted — no progress heartbeat for " + Math.floor(STALE_RUN_MS / 60000) + " minutes." });
  }
  const record: ArchiveRunRecord = {
    id: crypto.randomUUID(),
    job,
    phase: action === "export" ? "exporting" : "collecting",
    detail: "Starting…",
    posts: 0,
    pages: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeArchiveRun(record);
  void run(record, action, extras);
  return { ok: true, runId: record.id };
}

export async function stopXArchiveRun(): Promise<{ ok: boolean }> {
  const running = await readArchiveRun();
  if (running && (running.phase === "collecting" || running.phase === "exporting")) {
    await writeArchiveStop({ id: running.id });
  }
  return { ok: true };
}
