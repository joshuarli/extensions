import { Schema } from "effect";
import { mountYouTubeTranscriptPopup } from "../../extension-youtube-transcript/src/popup.ts";
import { isYouTubeUrl } from "../../extension-youtube-transcript/src/url.ts";
import { SuiteResponseSchema, type SuiteResponse } from "./message-contract.ts";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }),
  tabId = tab?.id,
  statusElement = required<HTMLDivElement>("#status"),
  arcToggle = required<HTMLButtonElement>("[data-arc-toggle]"),
  arcState = required<HTMLElement>("[data-arc-state]"),
  onefileSave = required<HTMLButtonElement>("[data-onefile-save]"),
  openOptions = required<HTMLAnchorElement>("[data-open-options]"),
  ytSection = required<HTMLElement>("[data-yt-section]"),
  xOpen = required<HTMLButtonElement>("[data-x-open]");

openOptions.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});

if (tabId === undefined) {
  setStatus("No active tab.", true);
  arcToggle.disabled = true;
  onefileSave.disabled = true;
} else {
  wireAllowRightClick(tabId);
  wireOnefile(tabId);
  wireXBookmarks();

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
    arcToggle.disabled = true;
    void send({ kind: "allow-right-click/toggle", tabId })
      .then((response) => {
        if ("error" in response && response.error) {
          setStatus(response.error, true);
          arcToggle.disabled = false;
          return;
        }
        window.close();
      })
      .catch((cause: unknown) => {
        setStatus(errorMessage(cause), true);
        arcToggle.disabled = false;
      });
  });
}

function wireOnefile(tabId: number): void {
  onefileSave.addEventListener("click", () => {
    onefileSave.disabled = true;
    void send({ kind: "onefile/save", tabId })
      .then((response) => {
        if ("error" in response && response.error) {
          setStatus(response.error, true);
          onefileSave.disabled = false;
          return;
        }
        window.close();
      })
      .catch((cause: unknown) => {
        setStatus(errorMessage(cause), true);
        onefileSave.disabled = false;
      });
  });
}

function wireXBookmarks(): void {
  xOpen.addEventListener("click", () => {
    xOpen.disabled = true;
    void send({ kind: "x-bookmarks/open-exporter" })
      .then((response) => {
        if ("error" in response && response.error) {
          setStatus(response.error, true);
          xOpen.disabled = false;
          return;
        }
        window.close();
      })
      .catch((cause: unknown) => {
        setStatus(errorMessage(cause), true);
        xOpen.disabled = false;
      });
  });
}

async function send(request: unknown): Promise<SuiteResponse> {
  return Schema.decodeUnknownSync(SuiteResponseSchema)(await chrome.runtime.sendMessage(request));
}

function setStatus(message: string, isError = false): void {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Popup markup is missing ${selector}.`);
  return element;
}
