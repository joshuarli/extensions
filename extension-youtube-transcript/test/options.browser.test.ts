import { afterEach, expect, test, vi } from "vitest";
import { mountYouTubeTranscriptOptions } from "../src/options.ts";
import { preferredLanguageStorageKey } from "../src/settings.ts";

afterEach(() => {
  document.body.replaceChildren();
});

test("settings page loads and saves a trimmed language preference", async () => {
  document.body.innerHTML = `
    <input data-yt-language />
    <button data-yt-save>Save</button>
    <div data-yt-status role="status"></div>`;
  let savedSettings: unknown;
  const chromeApi: unknown = Reflect.get(window, "chrome");
  if (typeof chromeApi !== "object" || chromeApi === null) {
    throw new Error("Chromium did not expose its chrome namespace.");
  }
  Object.assign(chromeApi, {
    storage: {
      local: {
        get: vi.fn(async () => ({ [preferredLanguageStorageKey]: "fr" })),
        set: vi.fn(async (settings: unknown) => {
          savedSettings = settings;
        }),
      },
    },
  });

  mountYouTubeTranscriptOptions(document);
  const languageInput = document.querySelector<HTMLInputElement>("[data-yt-language]")!;
  await vi.waitFor(() => expect(languageInput.value).toBe("fr"));
  languageInput.value = "  zh-CN  ";
  document.querySelector<HTMLButtonElement>("[data-yt-save]")!.click();

  await vi.waitFor(() =>
    expect(savedSettings).toEqual({ [preferredLanguageStorageKey]: "zh-CN" }),
  );
  expect(document.querySelector("[data-yt-status]")?.textContent).toBe("Saved.");
});
