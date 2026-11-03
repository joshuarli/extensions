import { Schema } from "effect";
import { requiredElement, setStatus } from "../../lib/extension-ui.ts";
import { ExtensionMessageSchema, ExtensionResponseSchema } from "./message-contract.ts";

type Action = "copyTranscript" | "copySrt" | "downloadFixtures";

const popupContext = "YouTube Transcript popup";

export interface YouTubeTranscriptPopupOptions {
  tabId: number;
  root: ParentNode;
}

export function mountYouTubeTranscriptPopup({
  tabId,
  root,
}: YouTubeTranscriptPopupOptions): void {
  const transcriptButton = requiredElement<HTMLButtonElement>(
      root,
      "[data-yt-copy-transcript]",
      popupContext,
    ),
    srtButton = requiredElement<HTMLButtonElement>(
      root,
      "[data-yt-copy-srt]",
      popupContext,
    ),
    copyErrorButton = requiredElement<HTMLButtonElement>(
      root,
      "[data-yt-copy-error]",
      popupContext,
    ),
    statusElement = requiredElement<HTMLDivElement>(
      root,
      "[data-yt-status]",
      popupContext,
    ),
    settingsLink = requiredElement<HTMLAnchorElement>(
      root,
      "[data-yt-settings-link]",
      popupContext,
    );

  let busy = false;
  let lastErrorDetail: string | undefined;

  settingsLink.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  if (import.meta.env.DEV) {
    const developerToggle = requiredElement<HTMLAnchorElement>(
        root,
        "[data-yt-developer-toggle]",
        popupContext,
      ),
      developerActions = requiredElement<HTMLDivElement>(
        root,
        "[data-yt-developer-actions]",
        popupContext,
      ),
      fixturesButton = requiredElement<HTMLButtonElement>(
        root,
        "[data-yt-download-fixtures]",
        popupContext,
      );

    developerToggle.hidden = false;

    developerToggle.addEventListener("click", (event) => {
      event.preventDefault();
      const expanded = developerActions.hidden;
      developerActions.hidden = !expanded;
      developerToggle.setAttribute("aria-expanded", String(expanded));
    });

    fixturesButton.addEventListener("click", () => void runAction("downloadFixtures"));
  }

  transcriptButton.addEventListener("click", () => void runAction("copyTranscript"));
  srtButton.addEventListener("click", () => void runAction("copySrt"));
  copyErrorButton.addEventListener("click", () => void copyErrorDetails());

  async function runAction(action: Action): Promise<void> {
    if (busy) return;
    busy = true;
    setBusy(true);

    try {
      const request = Schema.decodeUnknownSync(ExtensionMessageSchema)({ action, tabId }),
        response = Schema.decodeUnknownSync(ExtensionResponseSchema)(
          await chrome.runtime.sendMessage(request),
        );

      if ("error" in response) {
        setStatus(statusElement, response.error, true);
        if (response.errorDetail) showErrorDetails(response.errorDetail);
        busy = false;
        setBusy(false);
        return;
      }
      window.close();
    } catch (cause) {
      console.error("YouTube Transcript popup error:", cause);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setStatus(statusElement, error.message || "Something went wrong.", true);
      if (error.stack) showErrorDetails(error.stack);
      busy = false;
      setBusy(false);
    }
  }

  async function copyErrorDetails(): Promise<void> {
    if (!lastErrorDetail) return;
    try {
      await navigator.clipboard.writeText(lastErrorDetail);
      setStatus(statusElement, "Error details copied.");
      copyErrorButton.hidden = true;
    } catch {
      setStatus(statusElement, "Could not copy error details.", true);
    }
  }

  function showErrorDetails(details: string): void {
    lastErrorDetail = details;
    copyErrorButton.hidden = false;
  }

  function setBusy(value: boolean): void {
    transcriptButton.disabled = value;
    srtButton.disabled = value;
  }
}
