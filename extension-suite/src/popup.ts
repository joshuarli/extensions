import { Schema } from "effect";
import {
  errorMessage,
  requiredElement,
  setStatus,
} from "../../lib/extension-ui.ts";
import { mountYouTubeTranscriptPopup } from "../../extension-youtube-transcript/src/popup.ts";
import { isYouTubeUrl } from "../../extension-youtube-transcript/src/url.ts";
import { currentUserId, parseProfileScreenName, readCredentials, readProfileTarget } from "../../extension-x-bookmarks/src/capture.ts";
import { listProfileStates, openProfileArchive } from "../../extension-x-bookmarks/src/profile-storage.ts";
import { readArchiveRun, type ArchiveRunJob, type ArchiveRunRecord } from "../../extension-x-bookmarks/src/archive-run.ts";
import { SuiteResponseSchema, type SuiteResponse } from "./message-contract.ts";

const popupContext = "Popup";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }),
  tabId = tab?.id,
  statusElement = requiredElement<HTMLDivElement>(document, "#status", popupContext),
  arcToggle = requiredElement<HTMLButtonElement>(document, "[data-arc-toggle]", popupContext),
  arcState = requiredElement<HTMLElement>(document, "[data-arc-state]", popupContext),
  onefileSave = requiredElement<HTMLButtonElement>(document, "[data-onefile-save]", popupContext),
  openOptions = requiredElement<HTMLAnchorElement>(document, "[data-open-options]", popupContext),
  ytSection = requiredElement<HTMLElement>(document, "[data-yt-section]", popupContext),
  xProfileState = requiredElement<HTMLElement>(document, "[data-x-profile]", popupContext),
  xProfileDownload = requiredElement<HTMLButtonElement>(document, "[data-x-profile-download]", popupContext),
  xCollectOnly = requiredElement<HTMLButtonElement>(document, "[data-x-collect-profile]", popupContext),
  xDownloadExisting = requiredElement<HTMLButtonElement>(document, "[data-x-download-existing]", popupContext),
  xCollectBookmarks = requiredElement<HTMLButtonElement>(document, "[data-x-collect-bookmarks]", popupContext),
  xDownloadBookmarks = requiredElement<HTMLButtonElement>(document, "[data-x-download-bookmarks]", popupContext),
  xCollectLikes = requiredElement<HTMLButtonElement>(document, "[data-x-collect-likes]", popupContext),
  xDownloadLikes = requiredElement<HTMLButtonElement>(document, "[data-x-download-likes]", popupContext),
  xRunPanel = requiredElement<HTMLElement>(document, "[data-x-run]", popupContext),
  xPhase = requiredElement<HTMLElement>(document, "[data-x-phase]", popupContext),
  xCounts = requiredElement<HTMLElement>(document, "[data-x-counts]", popupContext),
  xFill = requiredElement<HTMLElement>(document, "[data-x-fill]", popupContext),
  xStop = requiredElement<HTMLButtonElement>(document, "[data-x-stop]", popupContext),
  xNote = requiredElement<HTMLElement>(document, "[data-x-note]", popupContext),
  xSelectWrap = requiredElement<HTMLElement>(document, "[data-x-select-wrap]", popupContext),
  xSelect = requiredElement<HTMLSelectElement>(document, "[data-x-select]", popupContext);

openOptions.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});

if (tabId === undefined) {
  setStatus(statusElement, "No active tab.", true);
  arcToggle.disabled = true;
  onefileSave.disabled = true;
} else {
  wireAllowRightClick(tabId);
  wireOnefile(tabId);

  if (isYouTubeUrl(tab?.url ?? "")) {
    ytSection.hidden = false;
    mountYouTubeTranscriptPopup({ tabId, root: ytSection });
  }
}

function wireAllowRightClick(tabId: number): void {
  void send({ kind: "allow-right-click/status", tabId })
    .then((response) => {
      if (!("status" in response)) return;
      const active = response.status === "on";
      arcState.textContent =
        response.status === "" ? "Not active" : active ? "On for this tab" : "Off for this tab";
      arcToggle.textContent = active ? "Disable right-click" : "Enable right-click";
    })
    .catch(() => {
      arcState.textContent = "Unavailable on this page";
    });

  arcToggle.addEventListener("click", () => {
    runSuiteAction(arcToggle, { kind: "allow-right-click/toggle", tabId });
  });
}

function wireOnefile(tabId: number): void {
  onefileSave.addEventListener("click", () => {
    runSuiteAction(onefileSave, { kind: "onefile/save", tabId });
  });
}

const xActionButtons = [xProfileDownload, xCollectOnly, xDownloadExisting, xCollectBookmarks, xDownloadBookmarks, xCollectLikes, xDownloadLikes];

function setXButtonLocked(button: HTMLButtonElement, locked: boolean, title: string): void {
  button.dataset["locked"] = locked ? "true" : "false";
  button.title = title;
}

function syncXButtons(busy: boolean): void {
  for (const button of xActionButtons) button.disabled = busy || button.dataset["locked"] === "true";
}

let xHandle: string | null = null;

function syncXButtonTitles(): void {
  if (xHandle) {
    const label = "@" + xHandle;
    xProfileDownload.textContent = "Download " + label + " archive";
    setXButtonLocked(xProfileDownload, false,
      "Collect the full archive (posts, reposts, replies) and save it to your downloads");
  } else {
    xProfileDownload.textContent = "Download archive";
    setXButtonLocked(xProfileDownload, true, "Disabled: visit a profile on x.com first");
  }
}

async function refreshXArchive(tabHandle: string | null): Promise<void> {
  const userId = await currentUserId();
  if (!userId) {
    xHandle = null;
    xProfileState.textContent = "Not signed in to X";
    for (const button of xActionButtons) setXButtonLocked(button, true, "Disabled: sign in to x.com in this browser first");
    setXButtonLocked(xDownloadBookmarks, false, "Rebuild the bookmarks archive JSON from your saved pages");
    setXButtonLocked(xDownloadLikes, false, "Rebuild the likes archive JSON from your saved pages");
    syncXButtons(false);
    return;
  }
  const stored = await readProfileTarget(userId);
  let label = tabHandle ?? stored?.screenName ?? null;
  if (!label && stored?.targetUserId) label = "user " + stored.targetUserId;
  xHandle = label && !label.startsWith("user ") ? label : null;
  xProfileState.textContent = label ? (xHandle ? "@" + xHandle : label) : "Visit a profile on x.com";
  setXButtonLocked(xCollectOnly, !label, label
    ? "Collect without downloading; saved pages are retained in the archive"
    : "Disabled: visit a profile on x.com first");
  syncXButtonTitles();

  try {
    const credentials = await readCredentials(userId);
    const bookmarksReady = !!credentials.queryIds["Bookmarks"] && !!credentials.authorization;
    setXButtonLocked(xCollectBookmarks, !bookmarksReady, bookmarksReady
      ? "Scan every bookmarked page (posts and folders) and download the archive JSON"
      : "Disabled: reload https://x.com/i/history in this browser");
    setXButtonLocked(xDownloadBookmarks, false, "Rebuild the bookmarks archive JSON from your saved pages");
    const likesReady = !!credentials.queryIds["Likes"] && !!credentials.authorization;
    setXButtonLocked(xCollectLikes, !likesReady, likesReady
      ? "Scan every liked page and download the archive JSON"
      : "Disabled: reload https://x.com/i/history/likes in this browser");
    setXButtonLocked(xDownloadLikes, false, "Rebuild the likes archive JSON from your saved pages");
  } catch {
    setXButtonLocked(xCollectBookmarks, false,
      "Scan every bookmarked page (posts and folders) and download the archive JSON");
    setXButtonLocked(xCollectLikes, false,
      "Scan every liked page and download the archive JSON");
  }

  try {
    const db = await openProfileArchive(userId);
    const targets = await listProfileStates(db);
    db.close();
    xSelect.replaceChildren();
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.targetUserId;
      const handle = target.state.profile?.screen_name;
      option.textContent = (handle ? "@" + handle : "user " + target.targetUserId)
        + " — " + target.postCount + " posts"
        + (target.state.posts === "complete" ? "" : " — partial");
      xSelect.append(option);
    }
    xSelectWrap.hidden = targets.length === 0;
    xDownloadExisting.hidden = targets.length === 0;
    setXButtonLocked(xDownloadExisting, targets.length === 0, "Disabled: no profile archive yet — collect one first");
    if (tabHandle) {
      const match = targets.find((target) => target.state.profile?.screen_name === tabHandle);
      if (match) xSelect.value = match.targetUserId;
    }
  } catch {
    xSelectWrap.hidden = true;
    xDownloadExisting.hidden = true;
    setXButtonLocked(xDownloadExisting, true, "Disabled: could not list profile archives");
  }
  syncXButtons(false);
}

let lastShownDoneId: string | null = null;

function renderXRun(run: ArchiveRunRecord | null): void {
  const active = !!run && (run.phase === "collecting" || run.phase === "exporting");
  xRunPanel.hidden = !active;
  xStop.disabled = !active;
  syncXButtons(active);
  if (active && run) {
    xPhase.textContent = run.phase === "collecting"
      ? run.job === "bookmarks" ? "Collecting bookmarks" : run.job === "likes" ? "Collecting likes" : "Scanning timeline"
      : "Downloading";
    xCounts.textContent = run.phase === "collecting"
      ? String(run.posts) + " posts · " + String(run.pages) + " pages"
      : (run.mediaTotal !== undefined
        ? "Media " + String(run.mediaDownloaded ?? 0) + "/" + String(run.mediaTotal)
        : run.detail);
    const mediaTotal = run.mediaTotal;
    const determinate = run.phase === "exporting" && typeof mediaTotal === "number" && mediaTotal > 0;
    xFill.style.width = determinate ? String(Math.floor((100 * (run.mediaDownloaded ?? 0)) / mediaTotal)) + "%" : "25%";
    xFill.classList.toggle("indeterminate", !determinate);
    if (xNote.textContent.startsWith("Failed:")) {
      xNote.hidden = true;
      xNote.classList.remove("error");
    }
    return;
  }
  if (run && (run.phase === "done" || run.phase === "error") && run.id !== lastShownDoneId) {
    lastShownDoneId = run.id;
    xNote.hidden = false;
    xNote.textContent = run.phase === "done" ? run.detail : "Failed: " + run.detail;
    xNote.classList.toggle("error", run.phase === "error");
    void send({ kind: "x-bookmarks/run", job: run.job, action: "dismiss" }).catch(() => { /* Badge clearing is best-effort. */ });
    const tabHandle = parseProfileScreenName(tab?.url ?? "");
    void refreshXArchive(tabHandle);
  }
}

function startXArchivePolling(): void {
  const tick = (): void => {
    void readArchiveRun().then(renderXRun).catch(() => { /* Keep polling; the record is optional. */ });
  };
  tick();
  setInterval(tick, 500);
}

function sendXArchiveRun(request: {
  job: ArchiveRunJob;
  action: "collect" | "download" | "export" | "stop";
  screenName?: string;
  targetUserId?: string;
}): void {
  xNote.hidden = false;
  xNote.textContent = "Starting…";
  xNote.classList.remove("error");
  void send({ kind: "x-bookmarks/run", ...request })
    .then((response) => {
      if ("error" in response && response.error) {
        xNote.textContent = response.error;
        xNote.classList.add("error");
        return;
      }
      void readArchiveRun().then(renderXRun).catch(() => null);
    })
    .catch((cause: unknown) => {
      xNote.textContent = errorMessage(cause);
      xNote.classList.add("error");
    });
}

function wireXProfileArchive(): void {
  const tabHandle = parseProfileScreenName(tab?.url ?? "");
  for (const button of xActionButtons) button.dataset["locked"] = "true";
  xStop.disabled = true;
  syncXButtons(false);
  void send({ kind: "x-bookmarks/run", job: "profile", action: "dismiss" }).catch(() => { /* Badge clearing is best-effort. */ });
  void refreshXArchive(tabHandle);
  startXArchivePolling();

  xProfileDownload.addEventListener("click", () => {
    sendXArchiveRun({ job: "profile", action: "download", ...(xHandle ? { screenName: xHandle } : {}) });
  });
  xCollectOnly.addEventListener("click", () => {
    sendXArchiveRun({ job: "profile", action: "collect", ...(xHandle ? { screenName: xHandle } : {}) });
  });
  xDownloadExisting.addEventListener("click", () => {
    const targetUserId = xSelect.value;
    if (!targetUserId) { xNote.hidden = false; xNote.textContent = "No archive selected."; xNote.classList.add("error"); return; }
    sendXArchiveRun({ job: "profile", action: "export", targetUserId });
  });
  xCollectBookmarks.addEventListener("click", () => {
    sendXArchiveRun({ job: "bookmarks", action: "download" });
  });
  xDownloadBookmarks.addEventListener("click", () => {
    sendXArchiveRun({ job: "bookmarks", action: "export" });
  });
  xCollectLikes.addEventListener("click", () => {
    sendXArchiveRun({ job: "likes", action: "download" });
  });
  xDownloadLikes.addEventListener("click", () => {
    sendXArchiveRun({ job: "likes", action: "export" });
  });
  xStop.addEventListener("click", () => {
    xStop.disabled = true;
    void send({ kind: "x-bookmarks/run", job: "profile", action: "stop" })
      .then(() => { xStop.disabled = false; })
      .catch(() => { xStop.disabled = false; });
  });
}

function runSuiteAction(button: HTMLButtonElement, request: unknown): void {
  button.disabled = true;
  void send(request)
    .then((response) => {
      if ("error" in response && response.error) {
        setStatus(statusElement, response.error, true);
        button.disabled = false;
        return;
      }
      window.close();
    })
    .catch((cause: unknown) => {
      setStatus(statusElement, errorMessage(cause), true);
      button.disabled = false;
    });
}

async function send(request: unknown): Promise<SuiteResponse> {
  return Schema.decodeUnknownSync(SuiteResponseSchema)(await chrome.runtime.sendMessage(request));
}

wireXProfileArchive();
