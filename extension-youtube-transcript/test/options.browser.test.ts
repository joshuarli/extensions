import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  document.body.replaceChildren();
});

test("settings page loads and saves a trimmed language preference", async () => {
  document.body.innerHTML = `
    <label for="language">Preferred transcript language</label>
    <input id="language" />
    <button id="save">Save</button>
    <div id="status" role="status"></div>`;
  let savedSettings: unknown;
  const chromeApi: unknown = Reflect.get(window, "chrome");
  if (typeof chromeApi !== "object" || chromeApi === null) {
    throw new Error("Chromium did not expose its chrome namespace.");
  }
  Object.assign(chromeApi, {
    storage: {
      local: {
        get: vi.fn(async () => ({ language: "fr" })),
        set: vi.fn(async (settings: unknown) => {
          savedSettings = settings;
        }),
      },
    },
  });

  await import("../src/options.ts");
  const languageInput = document.querySelector<HTMLInputElement>("#language")!;
  expect(languageInput.value).toBe("fr");
  languageInput.value = "  zh-CN  ";
  document.querySelector<HTMLButtonElement>("#save")!.click();

  await vi.waitFor(() => expect(savedSettings).toEqual({ language: "zh-CN" }));
  expect(document.querySelector("#status")?.textContent).toBe("Saved.");
});
