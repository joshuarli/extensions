import { Schema } from "effect";
import {
  errorMessage,
  requiredElement,
  setStatus,
} from "../../lib/extension-ui.ts";
import { mountYouTubeTranscriptPopup } from "../../extension-youtube-transcript/src/popup.ts";
import { isYouTubeUrl } from "../../extension-youtube-transcript/src/url.ts";
import { currentUserId, readProfileTarget } from "../../extension-x-bookmarks/src/capture.ts";
import { loadProfileState, openProfileArchive } from "../../extension-x-bookmarks/src/profile-storage.ts";
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
  xOpen = requiredElement<HTMLButtonElement>(document, "[data-x-open]", popupContext),
  xProfileState = requiredElement<HTMLElement>(document, "[data-x-profile]", popupContext),
  xProfileDownload = requiredElement<HTMLButtonElement>(document, "[data-x-profile-download]", popupContext);

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
  wireXBookmarks();
  wireXProfileArchive();

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

function wireXBookmarks(): void {
  xOpen.addEventListener("click", () => {
    runSuiteAction(xOpen, { kind: "x-bookmarks/open-exporter" });
  });
  xProfileDownload.addEventListener("click", () => {
    runSuiteAction(xProfileDownload, { kind: "x-bookmarks/collect-profile" });
  });
}

function wireXProfileArchive(): void {
  xProfileDownload.disabled = true;
  void (async () => {
    try {
      const userId = await currentUserId();
      if (!userId) {
        xProfileState.textContent = "Not signed in to X";
        xProfileDownload.title = "Disabled: sign in to x.com in this browser first";
        return;
      }
      const target = await readProfileTarget(userId);
      if (!target) {
        xProfileState.textContent = "Visit a profile on x.com first";
        xProfileDownload.title = "Disabled: visit a profile on x.com first";
        return;
      }
      let handle: string | null = null;
      try {
        const db = await openProfileArchive(userId);
        const state = await loadProfileState(db, target.targetUserId);
        db.close();
        handle = state?.profile?.screen_name ?? null;
      } catch { /* Handle stays unknown until the first scan. */ }
      const label = handle ? "@" + handle : "user " + target.targetUserId;
      xProfileState.textContent = label;
      xProfileDownload.disabled = false;
      xProfileDownload.textContent = "Download " + label;
      xProfileDownload.title = "Collect the full archive (posts, reposts, replies) and save it to your downloads";
    } catch {
      xProfileState.textContent = "Unavailable";
      xProfileDownload.title = "Disabled: could not read the X session in this browser";
    }
  })();
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
