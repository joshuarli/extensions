import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
});

test("popup sends the selected action and presents a typed background error", async () => {
  document.body.innerHTML = `
    <button id="copy-transcript"></button>
    <button id="copy-srt"></button>
    <button id="copy-error" hidden></button>
    <div id="status" role="status"></div>
    <a id="settings-link" href="#"></a>
    <a id="developer-toggle" href="#"></a>
    <div id="developer-actions" hidden></div>
    <button id="download-fixtures"></button>`;
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
    tabs: { query: vi.fn(async () => [{ id: 42 }]) },
  });

  await import("../src/popup.ts");
  document.querySelector<HTMLButtonElement>("#copy-transcript")!.click();

  await vi.waitFor(() => {
    expect(document.querySelector("#status")?.textContent).toBe("No transcript found.");
  });
  expect(sentMessage).toEqual({ action: "copyTranscript", tabId: 42 });
  expect(document.querySelector<HTMLButtonElement>("#copy-error")?.hidden).toBe(false);
});
