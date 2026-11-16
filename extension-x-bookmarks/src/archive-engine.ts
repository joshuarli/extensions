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
  downloadDebugJson,
  downloadPostsJson,
  downloadPostsMedia,
  exportFolderName,
} from "./profile-export.ts";
import { buildDebugReport, recordLastError, type DebugStatusEntry } from "./debug.ts";
import { currentUserId, readProfileTarget } from "./capture.ts";

const statusLog: DebugStatusEntry[] = [];

function log(text: string): void {
  statusLog.push({ text, at: new Date().toISOString() });
  if (statusLog.length > 40) statusLog.shift();
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
          statusLog,
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
            statusLog,
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
    await patchArchiveRun({ phase: "exporting", detail: "Preparing bookmarks JSON" });
    const data = await assembleArchive(db, account);
    const filename = "x-bookmarks_" + account + "_" + new Date().toISOString().slice(0, 10) + ".json";
    const jsonText = JSON.stringify(data, null, 2);
    const bytes = new TextEncoder().encode(jsonText);
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    await chrome.downloads.download({
      url: "data:application/json;base64," + btoa(binary),
      filename,
      saveAs: true,
      conflictAction: "uniquify",
    });
    return "JSON download requested: " + filename + ". Check browser downloads for completion.";
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

export async function startXArchiveRun(
  action: ArchiveRunAction,
  job: ArchiveRunJob,
  extras: RunExtras = {},
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const running = await readArchiveRun();
  if (running && (running.phase === "collecting" || running.phase === "exporting")) {
    return { ok: false, error: "Another archive run is already in progress." };
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
