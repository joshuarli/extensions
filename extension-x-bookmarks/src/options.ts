import { errorMessage, requiredElement } from "../../lib/extension-ui.ts";
import {
  currentUserId,
  readCredentials,
  readProfileTarget,
  BOOKMARK_OPERATIONS,
  PROFILE_OPERATIONS,
} from "./capture.ts";
import { collect, collectProfile, type CollectionOptions, type ProgressSnapshot } from "./collector.ts";
import { readXProfileLastCapture, readXProfileUnmatchedOps } from "./background.ts";
import { assembleArchive, bookmarkCount, loadState, openArchive } from "./storage.ts";
import {
  assembleProfileArchive,
  listProfileStates,
  openProfileArchive,
  profilePostCount,
  type SavedProfileTarget,
} from "./profile-storage.ts";
import { collectMediaJobs } from "./media.ts";
import { downloadPostsJson, downloadPostsMedia, downloadDebugJson, exportFolderName } from "./profile-export.ts";
import { buildDebugReport, recordLastError, type DebugStatusEntry } from "./debug.ts";

const pageContext = "X Archive";

const accountElement = requiredElement<HTMLElement>(document, "#account", pageContext);
const captureElement = requiredElement<HTMLElement>(document, "#capture", pageContext);
const countElement = requiredElement<HTMLElement>(document, "#count", pageContext);
const coverageElement = requiredElement<HTMLElement>(document, "#coverage", pageContext);
const profileCaptureElement = requiredElement<HTMLElement>(document, "#profile-capture", pageContext);
const profileCountElement = requiredElement<HTMLElement>(document, "#profile-count", pageContext);
const profileCoverageElement = requiredElement<HTMLElement>(document, "#profile-coverage", pageContext);
const profileCaptureLogElement = requiredElement<HTMLElement>(document, "#profile-capture-log", pageContext);
const profileUnmatchedElement = requiredElement<HTMLElement>(document, "#profile-unmatched", pageContext);
const statusElement = requiredElement<HTMLOutputElement>(document, "#status", pageContext);
const refreshButton = requiredElement<HTMLButtonElement>(document, "#refresh", pageContext);
const collectButton = requiredElement<HTMLButtonElement>(document, "#collect", pageContext);
const stopButton = requiredElement<HTMLButtonElement>(document, "#stop", pageContext);
const downloadButton = requiredElement<HTMLButtonElement>(document, "#download", pageContext);
const collectProfileButton = requiredElement<HTMLButtonElement>(document, "#collect-profile", pageContext);
const profileSelect = requiredElement<HTMLSelectElement>(document, "#profile-select", pageContext);
const downloadProfileButton = requiredElement<HTMLButtonElement>(document, "#download-profile", pageContext);

const hud = requiredElement<HTMLElement>(document, "#hud", pageContext);
const hudPhase = requiredElement<HTMLElement>(document, "#hud-phase", pageContext);
const hudPosts = requiredElement<HTMLElement>(document, "#hud-posts", pageContext);
const hudPages = requiredElement<HTMLElement>(document, "#hud-pages", pageContext);
const hudElapsed = requiredElement<HTMLElement>(document, "#hud-elapsed", pageContext);
const hudFill = requiredElement<HTMLElement>(document, "#hud-fill", pageContext);
const hudDetail = requiredElement<HTMLElement>(document, "#hud-detail", pageContext);
const hudMinimize = requiredElement<HTMLButtonElement>(document, "#hud-minimize", pageContext);
const hudLabelA = requiredElement<HTMLElement>(document, "#hud-label-a", pageContext);
const hudLabelB = requiredElement<HTMLElement>(document, "#hud-label-b", pageContext);

let db: IDBDatabase | null = null;
let profileDb: IDBDatabase | null = null;
let userId: string | null = null;
let controller: AbortController | null = null;
let busy = false;
let connectionReady = false;
let profileReady = false;

let hudStartedAt = 0;
let hudTimer: ReturnType<typeof setInterval> | null = null;

const debugStatusLog: DebugStatusEntry[] = [];

function status(message: string): void {
  debugStatusLog.push({ text: message, at: new Date().toISOString() });
  if (debugStatusLog.length > 40) debugStatusLog.shift();
  statusElement.textContent = message;
}

function setBadge(text: string, color?: string): void {
  try {
    void chrome.action.setBadgeText({ text });
    if (color) void chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* Badge is best-effort decoration. */ }
}

function clearBadge(): void {
  try {
    void chrome.action.setBadgeText({ text: "" });
  } catch { /* Badge is best-effort decoration. */ }
}

function capCount(value: number): string {
  return value > 999 ? "999+" : String(value);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ":" + String(seconds).padStart(2, "0");
}

function hudSetDetail(message: string): void {
  hudDetail.textContent = message.split("\n")[0] ?? message;
  hudDetail.title = message;
}

function startHud(phase: string): void {
  hudStartedAt = Date.now();
  setBadge("…", "#1a73e8");
  hudPhase.textContent = phase;
  hudPosts.textContent = "0";
  hudPages.textContent = "0";
  hudElapsed.textContent = "0:00";
  hudDetail.textContent = "Starting…";
  hudFill.classList.add("indeterminate");
  hudFill.style.width = "";
  hudLabelA.textContent = "posts";
  hudLabelB.textContent = "pages";
  hud.classList.remove("done", "error", "collapsed");
  hud.hidden = false;
  if (hudTimer !== null) clearInterval(hudTimer);
  hudTimer = setInterval(() => {
    hudElapsed.textContent = formatElapsed(Date.now() - hudStartedAt);
  }, 500);
}

function updateHudCounts(snapshot: ProgressSnapshot): void {
  hudPosts.textContent = capCount(snapshot.posts);
  hudPages.textContent = String(snapshot.pages);
  setBadge(capCount(snapshot.posts), "#1a73e8");
}

function setHudDeterminate(fraction: number): void {
  hudFill.classList.remove("indeterminate");
  hudFill.style.width = Math.min(100, Math.max(0, fraction * 100)) + "%";
}

function updateHudExport(progress: { downloaded: number; failed: number; total: number }): void {
  const settled = progress.downloaded + progress.failed;
  hudLabelA.textContent = "media";
  hudLabelB.textContent = "of " + progress.total;
  hudPosts.textContent = capCount(progress.downloaded);
  hudPages.textContent = String(settled);
  setHudDeterminate(progress.total === 0 ? 1 : settled / progress.total);
  hudSetDetail("Downloading media: " + settled + "/" + progress.total + " settled, " + progress.failed + " failed.");
  setBadge(capCount(progress.downloaded), "#1a73e8");
}

function finishHud(ok: boolean, phase: string, detail: string): void {
  if (hudTimer !== null) {
    clearInterval(hudTimer);
    hudTimer = null;
  }
  hudElapsed.textContent = formatElapsed(Date.now() - hudStartedAt);
  hudPhase.textContent = phase;
  hudDetail.textContent = detail;
  hudDetail.title = detail;
  hud.classList.toggle("done", ok);
  hud.classList.toggle("error", !ok);
  setBadge(ok ? "✓" : "!", ok ? "#188038" : "#c5221f");
}

hudMinimize.addEventListener("click", () => {
  hud.classList.toggle("collapsed");
  hudMinimize.textContent = hud.classList.contains("collapsed") ? "+" : "–";
  hudMinimize.setAttribute("aria-label", hud.classList.contains("collapsed") ? "Expand progress panel" : "Collapse progress panel");
});

function setBusy(value: boolean): void {
  busy = value;
  refreshButton.disabled = value;
  collectButton.disabled = value || !connectionReady;
  collectProfileButton.disabled = value || !profileReady;
  downloadButton.disabled = value || !db;
  downloadProfileButton.disabled = value || !profileDb || profileSelect.options.length === 0;
  stopButton.disabled = !value;
  if (value) {
    stopButton.title = "Stops the current run; saved pages are retained";
    for (const button of [refreshButton, collectButton, collectProfileButton, downloadButton, downloadProfileButton]) {
      button.title = "Working — click Stop to cancel";
    }
  }
}

function optionLabel(target: SavedProfileTarget): string {
  const screenName = target.state.profile?.screen_name;
  const name = target.state.profile?.name;
  const handle = screenName ? "@" + screenName : "user " + target.targetUserId;
  const suffix = name && screenName ? " (" + name + ")" : "";
  const coverage = target.state.posts === "complete" ? "" : " — partial";
  return handle + suffix + " — " + target.postCount + " posts" + coverage;
}

let lastTargets: SavedProfileTarget[] = [];

async function refreshProfileTargets(account: string): Promise<SavedProfileTarget[]> {
  if (!profileDb) return [];
  const targets = await listProfileStates(profileDb);
  lastTargets = targets;
  const previous = profileSelect.value;
  profileSelect.replaceChildren();
  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.targetUserId;
    option.textContent = optionLabel(target);
    profileSelect.append(option);
  }
  const pending = await readProfileTarget(account);
  if (pending?.targetUserId && !targets.some((target) => target.targetUserId === pending.targetUserId)) {
    const option = document.createElement("option");
    option.value = pending.targetUserId;
    option.textContent = (pending.screenName ? "@" + pending.screenName : "user " + pending.targetUserId)
      + " — captured, not scanned yet";
    profileSelect.append(option);
  }
  const requestedName = requestedProfile?.screenName;
  if (previous && [...profileSelect.options].some((option) => option.value === previous)) {
    profileSelect.value = previous;
  } else if (requestedName) {
    const match = targets.find((entry) => entry.state.profile?.screen_name === requestedName);
    if (match) {
      profileSelect.value = match.targetUserId;
    } else if (pending?.screenName === requestedName && pending.targetUserId) {
      profileSelect.value = pending.targetUserId;
    }
  }
  return targets;
}

async function refresh(): Promise<void> {
  if (busy) return;
  const activeId = await currentUserId();
  if (activeId !== userId) {
    db?.close();
    profileDb?.close();
    db = null;
    profileDb = null;
    userId = activeId;
    if (userId) {
      try {
        db = await openArchive(userId);
        profileDb = await openProfileArchive(userId);
      } catch (error) {
        db?.close();
        profileDb?.close();
        db = null;
        profileDb = null;
        userId = null;
        accountElement.textContent =
          "Archive failed to open (" + errorMessage(error) + "). Click Refresh to retry.";
        throw error;
      }
    }
  }
  accountElement.textContent = userId ?? "Not signed in to X";
  if (!userId || !db || !profileDb) {
    captureElement.textContent = "Unavailable";
    countElement.textContent = "—";
    coverageElement.textContent = "—";
    profileCaptureElement.textContent = "Unavailable";
    profileCaptureLogElement.textContent = "Unavailable";
    profileUnmatchedElement.textContent = "Unavailable";
    profileCountElement.textContent = "—";
    profileCoverageElement.textContent = "—";
    profileSelect.replaceChildren();
    connectionReady = false;
    profileReady = false;
    collectButton.disabled = true;
    collectButton.title = "Disabled: sign in to x.com in this browser first";
    downloadButton.disabled = true;
    downloadButton.title = "Disabled: sign in to x.com in this browser first";
    collectProfileButton.disabled = true;
    collectProfileButton.title = "Disabled: sign in to x.com in this browser first";
    downloadProfileButton.disabled = true;
    downloadProfileButton.title = "Disabled: sign in to x.com in this browser first";
    refreshButton.disabled = false;
    refreshButton.title = "Re-check sign-in and captured requests";
    stopButton.title = "Nothing is running";
    accountElement.textContent = "Not signed in to X in this browser";
    status("The exporter can only see this browser's cookies. Sign in to x.com in this browser, reload, then Refresh connection.");
    return;
  }
  const account = userId;
  const credentials = await readCredentials(account);

  const bookmarkNames = [...BOOKMARK_OPERATIONS];
  const bookmarkAvailable = bookmarkNames.filter((name) => !!credentials.queryIds[name]);
  captureElement.textContent = bookmarkAvailable.length
    ? bookmarkAvailable.join(", ") + (credentials.authorization ? "" : " (missing authorization header)")
    : "No requests captured — reload X bookmarks";
  connectionReady = !!credentials.queryIds["Bookmarks"] && !!credentials.authorization;
  collectButton.disabled = !connectionReady;
  collectButton.title = connectionReady
    ? "Collect every bookmarked page into the local archive (this can take a while)"
    : "Disabled: open and reload https://x.com/i/bookmarks in this browser";
  downloadButton.disabled = false;
  downloadButton.title = "Download the cumulative bookmark archive JSON";
  stopButton.title = "Stops the current run; saved pages are retained";
  refreshButton.title = "Re-check sign-in and captured requests";
  countElement.textContent = String(await bookmarkCount(db));
  const previous = await loadState(db);
  coverageElement.textContent = previous
    ? "Bookmarks: " + previous.bookmarks + "; folders: " + previous.folders + ". " + previous.reason
    : "Not scanned";

  const profileNames = [...PROFILE_OPERATIONS];
  const profileAvailable = profileNames.filter((name) => !!credentials.queryIds[name]);
  const lastCapture = await readXProfileLastCapture();
  const unmatchedOps = await readXProfileUnmatchedOps();
  const target = await readProfileTarget(account);
  const requested = requestedProfile?.screenName;
  const targets = await refreshProfileTargets(account);
  const scannedTarget = target
    ? targets.find((entry) => entry.targetUserId === target.targetUserId)
    : undefined;
  const handle = scannedTarget?.state.profile?.screen_name ?? target?.screenName;
  if (requested) {
    profileCaptureElement.textContent = "@" + requested + " — requested from the profile tab that opened this page"
      + (target?.screenName === requested && target.targetUserId ? " (resolved to user " + target.targetUserId + ")" : "")
      + (profileAvailable.length ? "" : " — no requests captured yet; reload the profile tab on x.com");
  } else if (target) {
    profileCaptureElement.textContent = (handle ? "@" + handle + " " : "") + (target.targetUserId ? "user " + target.targetUserId : "profile")
      + " (" + target.operation + ") — visited " + new Date(target.capturedAt).toLocaleString()
      + (profileAvailable.length ? "" : " — no requests captured yet; load the profile on x.com");
  } else {
    profileCaptureElement.textContent = "None captured — visit a profile on x.com (Posts and Replies tabs)";
  }
  const timelineReady = !!(credentials.queryIds["UserTweetsAndReplies"] || credentials.queryIds["UserTweets"]);
  const requestedReady = requested !== undefined && (
    (target?.screenName === requested && !!target.targetUserId)
    || !!credentials.queryIds["UserByScreenName"]
  );
  profileReady = (requested !== undefined ? requestedReady : !!target) && timelineReady;
  collectProfileButton.disabled = !profileReady;
  collectProfileButton.title = profileReady
    ? "Collect the captured profile's posts (and replies, when the Replies tab was captured)"
    : requested !== undefined
      ? "Disabled: reload https://x.com/" + requested + " once in this browser"
      : "Disabled: visit a profile on x.com first";
  profileCaptureLogElement.textContent = lastCapture
    ? "Last captured: " + lastCapture.operation
      + (lastCapture.targetUserId ? " (target user " + lastCapture.targetUserId + ")" : "")
      + " — " + new Date(lastCapture.at).toLocaleString()
    : "None yet — reload the profile tab on x.com";
  profileUnmatchedElement.textContent = unmatchedOps.length === 0
    ? "None — every request X made on this page is known"
    : unmatchedOps.slice(0, 10)
        .map((entry) => entry.operation + (entry.variables ? " " + entry.variables : ""))
        .join("\n")
      + (unmatchedOps.length > 10 ? "\n…" : "")
      + "\n(operations the extension saw but doesn't understand)";
  downloadProfileButton.disabled = profileSelect.options.length === 0;
  downloadProfileButton.title = profileSelect.options.length === 0
    ? "Disabled: no profile archive yet — collect one first"
    : "Download posts.json and media into one folder";
  if (targets.length) {
    const selected = targets.find((entry) => entry.targetUserId === profileSelect.value) ?? targets[0];
    if (selected) {
      profileCountElement.textContent = String(await profilePostCount(profileDb, selected.targetUserId));
      profileCoverageElement.textContent = "Posts: " + selected.state.posts + ". " + selected.state.reason;
    }
  } else {
    profileCountElement.textContent = target ? "0" : "—";
    profileCoverageElement.textContent = "Not scanned";
  }
}

refreshButton.addEventListener("click", () => {
  void refresh().catch((cause: unknown) => status("Connection error: " + errorMessage(cause)));
});

profileSelect.addEventListener("change", () => {
  if (!profileDb) return;
  const archiveDb = profileDb;
  const selected = profileSelect.value;
  const match = lastTargets.find((entry) => entry.targetUserId === selected);
  profileCoverageElement.textContent = match
    ? "Posts: " + match.state.posts + ". " + match.state.reason
    : "Not scanned";
  void (async () => {
    profileCountElement.textContent = String(await profilePostCount(archiveDb, selected));
  })().catch(() => { /* Selection refresh is cosmetic. */ });
});

let autoExportAfterCollect: "profile" | "bookmarks" | null = null;

function runCollection(
  label: "bookmarks" | "profile",
  lockName: string,
  collectionDb: IDBDatabase | null,
  job: (options: CollectionOptions, signal: AbortSignal) => Promise<unknown>,
): void {
  if (busy || !userId || !collectionDb) return;
  const account = userId;
  controller = new AbortController();
  const signal = controller.signal;
  let succeeded = false;
  setBusy(true);
  startHud(label === "bookmarks" ? "Collecting bookmarks" : "Collecting profile posts");
  void navigator.locks.request(lockName + "-" + account, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another tab is already collecting for this account.");
    const options: CollectionOptions = {
      db: collectionDb,
      userId: account,
      signal,
      report: (message: string) => {
        status(message);
        hudSetDetail(message);
      },
      onProgress: (snapshot: ProgressSnapshot) => {
        updateHudCounts(snapshot);
      },
    };
    return job(options, signal);
  }).then((result) => {
    succeeded = true;
    const reason = (result as { reason?: string } | null)?.reason;
    finishHud(true, label === "bookmarks" ? "Bookmarks collected" : "Profile collected", reason ?? "Saved pages are retained.");
    status("Collection finished" + (reason ? ": " + reason : "."));
  }).catch((cause: unknown) => {
    const message = errorMessage(cause);
    void recordLastError(label, message);
    finishHud(false, "Collection stopped", message);
    status("Collection stopped: " + message + ". Saved pages are retained.");
  }).finally(() => {
    controller = null;
    setBusy(false);
    const shouldExport = succeeded && autoExportAfterCollect === label;
    autoExportAfterCollect = null;
    void refresh()
      .then(() => {
        if (shouldExport) {
          (label === "profile" ? downloadProfileButton : downloadButton).click();
        }
      })
      .catch((cause: unknown) => status("Refresh error: " + errorMessage(cause)));
  });
}

collectButton.addEventListener("click", () => {
  runCollection("bookmarks", "x-bookmarks-collection", db, (options) => collect(options));
});

collectProfileButton.addEventListener("click", () => {
  runCollection("profile", "x-profile-collection", profileDb, (options) => collectProfile(options, requestedProfile));
});

stopButton.addEventListener("click", () => {
  controller?.abort();
  stopButton.disabled = true;
  hudSetDetail("Stopping…");
  status("Stopping. Saved pages will be retained.");
});

downloadButton.addEventListener("click", () => {
  if (busy || !db || !userId) return;
  const archive = db;
  const account = userId;
  setBusy(true);
  startHud("Preparing bookmarks JSON");
  setHudDeterminate(1);
  void (async () => {
    const data = await assembleArchive(archive, account);
    const filename = "x-bookmarks_" + account + "_" + new Date().toISOString().slice(0, 10) + ".json";
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: true, conflictAction: "uniquify" });
      finishHud(true, "Bookmarks exported", filename);
      status("JSON download requested: " + filename + ". Check browser downloads for completion.");
    } finally {
      // Chrome may still be displaying its save-as dialog when download() resolves.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    }
  })().catch((cause: unknown) => {
    finishHud(false, "Export failed", errorMessage(cause));
    status("Export failed: " + errorMessage(cause));
  }).finally(() => {
    setBusy(false);
  });
});

downloadProfileButton.addEventListener("click", () => {
  if (busy || !profileDb || !userId) return;
  const targetUserId = profileSelect.value;
  if (!targetUserId) {
    status("No profile selected to export.");
    return;
  }
  const archiveDb = profileDb;
  const account = userId;
  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true);
  startHud("Exporting profile archive");
  setHudDeterminate(0);
  void (async () => {
    let folder: string | null = null;
    try {
      const archive = await assembleProfileArchive(archiveDb, account, targetUserId);
      const storedTarget = await readProfileTarget(account);
      folder = exportFolderName(archive.profile.screen_name ?? storedTarget?.screenName, targetUserId);
      const jobs = collectMediaJobs(archive.posts);
      hudPhase.textContent = "Writing posts.json";
      const jsonFilename = await downloadPostsJson(JSON.stringify(archive, null, 2), folder);
      status("Saved " + jsonFilename + ". Downloading " + jobs.jobs.length + " media files to " + folder + "/media/…");
      hudPhase.textContent = "Downloading media";
      const mediaResult = await downloadPostsMedia(jobs.jobs, folder, {
        report: status,
        signal,
        onProgress: updateHudExport,
      });
      const failedCount = mediaResult.failed.length;
      let debugNote = "";
      try {
        const report = await buildDebugReport({
          accountId: account,
          requestedProfile: requestedProfile?.screenName,
          exportFolder: folder,
          extensionVersion: chrome.runtime.getManifest().version,
          archive: archive.export_metadata,
          media: mediaResult,
          statusLog: debugStatusLog,
        });
        const debugFilename = await downloadDebugJson(JSON.stringify(report, null, 2), folder);
        debugNote = " Debug report: " + debugFilename + ".";
      } catch (debugError) {
        debugNote = " Debug report failed: " + errorMessage(debugError) + ".";
      }
      const summary = "Exported " + archive.posts.length + " posts to " + jsonFilename +
        " with " + mediaResult.downloaded + "/" + mediaResult.total + " media files" +
        (failedCount ? " (" + failedCount + " failed — re-run Download archive to retry)" : "") +
        (mediaResult.stopped ? " — stopped early" : "") + "." + debugNote;
      hudSetDetail(summary);
      finishHud(failedCount === 0 && !mediaResult.stopped, failedCount === 0 ? "Archive exported" : "Archive exported with gaps",
        "Folder: " + folder + "/");
      status(summary);
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      void recordLastError("profile export", message);
      if (folder) {
        try {
          const report = await buildDebugReport({
            accountId: account,
            requestedProfile: requestedProfile?.screenName,
            exportFolder: folder,
            extensionVersion: chrome.runtime.getManifest().version,
          archive: { profile: null, collection: { posts: "error", reason: message }, stats: null },
            media: null,
            statusLog: debugStatusLog,
          });
          await downloadDebugJson(JSON.stringify(report, null, 2), folder);
        } catch { /* The export error is the one that matters. */ }
      }
      throw cause;
    }
  })().catch((cause: unknown) => {
    const message = errorMessage(cause);
    finishHud(false, "Export failed", message);
    status("Export failed: " + message);
  }).finally(() => {
    controller = null;
    setBusy(false);
    void refresh().catch((cause: unknown) => status("Refresh error: " + errorMessage(cause)));
  });
});

const autoParams = new URLSearchParams(location.search);
const autoCollectKind = autoParams.get("collect");
const autoExport = autoParams.get("export") === "1";
const requestedProfileName = autoParams.get("profile");
const requestedProfile = requestedProfileName && /^[A-Za-z0-9_]{1,15}$/u.test(requestedProfileName)
  ? { screenName: requestedProfileName }
  : undefined;

function maybeAutoCollect(kind: string | null): void {
  if (kind === "profile" && !collectProfileButton.disabled) {
    autoExportAfterCollect = autoExport ? "profile" : null;
    collectProfileButton.click();
    return;
  }
  if (kind === "bookmarks" && !collectButton.disabled) {
    autoExportAfterCollect = autoExport ? "bookmarks" : null;
    collectButton.click();
    return;
  }
  if (kind === "profile") {
    status(requestedProfile
      ? "Opened from the popup, but collection isn't ready yet: reload https://x.com/"
        + requestedProfile.screenName + " once in this browser, then click Collect profile posts."
      : "Opened from the context menu, but profile collection isn't ready yet: "
        + "visit a profile on x.com in this browser first, then click Collect profile posts.");
    return;
  }
  if (kind === "bookmarks") {
    status("Opened from the context menu, but bookmark collection isn't ready: "
      + "sign in to x.com in this browser, reload https://x.com/i/bookmarks, then click Collect bookmarks.");
  }
}

clearBadge();
void refresh()
  .then(() => maybeAutoCollect(autoCollectKind))
  .catch((cause: unknown) => status("Initialization failed: " + errorMessage(cause)));
