import { TabNotAccessibleError } from "./error.ts";

const transcriptBtn = document.querySelector<HTMLButtonElement>("#copy-transcript")!;
const srtBtn = document.querySelector<HTMLButtonElement>("#copy-srt")!;
const copyErrorBtn = document.querySelector<HTMLButtonElement>("#copy-error")!;
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const settingsLink = document.querySelector<HTMLAnchorElement>("#settings-link")!;

let busy = false;
let lastErrorDetail: string | undefined;

settingsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

if (process.env["NODE_ENV"] !== "production") {
  const developerToggle = document.querySelector<HTMLAnchorElement>("#developer-toggle")!;
  const developerActions = document.querySelector<HTMLDivElement>("#developer-actions")!;
  const fixturesBtn = document.querySelector<HTMLButtonElement>("#download-fixtures")!;

  developerToggle.addEventListener("click", (e) => {
    e.preventDefault();
    const expanded = developerActions.hidden;
    developerActions.hidden = !expanded;
    developerToggle.setAttribute("aria-expanded", String(expanded));
  });

  fixturesBtn.addEventListener("click", () => runAction("downloadFixtures"));
}

transcriptBtn.addEventListener("click", () => runAction("copyTranscript"));
srtBtn.addEventListener("click", () => runAction("copySrt"));
copyErrorBtn.addEventListener("click", async () => {
  if (!lastErrorDetail) return;
  try {
    await navigator.clipboard.writeText(lastErrorDetail);
    setStatus("Error details copied.");
    copyErrorBtn.hidden = true;
  } catch {
    setStatus("Could not copy error details.", true);
  }
});

async function runAction(action: string, opts: Record<string, unknown> = {}): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  disableAll(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new TabNotAccessibleError("No active tab found.");
    }

    const response = await chrome.runtime.sendMessage({ action, tabId: tab.id, ...opts });

    if (response?.error) {
      setStatus(response.error, true);
      if (response.errorDetail) {
        lastErrorDetail = response.errorDetail;
        copyErrorBtn.hidden = false;
      }
      disableAll(false);
      busy = false;
      return;
    }
    window.close();
  } catch (error) {
    console.error("YouTube Transcript popup error:", error);
    const err = error as Error;
    setStatus(err.message || "Something went wrong.", true);
    if (err.stack) {
      lastErrorDetail = err.stack;
      copyErrorBtn.hidden = false;
    }
    disableAll(false);
    busy = false;
  }
}

function disableAll(disabled: boolean): void {
  transcriptBtn.disabled = disabled;
  srtBtn.disabled = disabled;
}

function setStatus(message: string, isError?: boolean): void {
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "";
}
export {};
