import { afterEach, expect, test, vi } from "vitest";
import { mountYouTubeTranscriptPopup } from "../src/popup.ts";

afterEach(() => {
  document.body.replaceChildren();
});

test("popup sends the selected action and presents a typed background error", async () => {
  document.body.innerHTML = `
    <button data-yt-copy-transcript></button>
    <button data-yt-copy-srt></button>
    <button data-yt-copy-error hidden></button>
    <div data-yt-status role="status"></div>
    <a data-yt-settings-link href="#"></a>
    <a data-yt-developer-toggle href="#"></a>
    <div data-yt-developer-actions hidden></div>
    <button data-yt-download-fixtures></button>`;
  let sentMessage: unknown;
  const chromeApi: unknown = Reflect.get(window, "chrome");
  if (typeof chromeApi !== "object" || chromeApi === null) {
    throw new Error("Chromium did not expose its chrome namespace.");
  }
  Object.assign(chromeApi, {
    runtime: {
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn(async (message: unknown) => {
        sentMessage = message;
        return { error: "No transcript found.", errorDetail: "NoTranscriptError details" };
      }),
    },
  });

  mountYouTubeTranscriptPopup({ tabId: 42, root: document });
  document.querySelector<HTMLButtonElement>("[data-yt-copy-transcript]")!.click();

  await vi.waitFor(() => {
    expect(document.querySelector("[data-yt-status]")?.textContent).toBe("No transcript found.");
  });
  expect(sentMessage).toEqual({ action: "copyTranscript", tabId: 42 });
  expect(document.querySelector<HTMLButtonElement>("[data-yt-copy-error]")?.hidden).toBe(false);
});
