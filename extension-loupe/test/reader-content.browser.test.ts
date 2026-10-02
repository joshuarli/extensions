import { afterEach, expect, test, vi } from "vitest";
import readerContentScript from "../../build/browser-test/reader-content.js?raw";

afterEach(() => {
  document.body.replaceChildren();
});

test("reader content renders in Chromium and opens Obsidian with clipboard fallback", async () => {
  let messageListener: ((message: { action: string }) => void) | undefined,
    obsidianUrl = "",
    clipboardText = "",
    clipboardShouldFail = false;

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        if (clipboardShouldFail) throw new Error("clipboard unavailable");
        clipboardText = text;
      }),
    },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => false,
  });
  const chromeApi: unknown = Reflect.get(window, "chrome");
  if (typeof chromeApi !== "object" || chromeApi === null) {
    throw new Error("Chromium did not expose its chrome namespace.");
  }
  Object.assign(chromeApi, {
    runtime: {
      onMessage: { addListener: (listener: (message: { action: string }) => void) => {
        messageListener = listener;
      } },
      sendMessage: async (message: { action: string; obsidianUrl?: unknown }) => {
        if (message.action === "parsePage") {
          return {
            ok: true,
            parsedPage: {
              content: "<h2 id='section'>Section</h2><p>Readable text.</p>",
              content_markdown: "# Section\\n\\n![photo](https://example.com/photo.jpg)",
              title: "Rendered article",
              author: "",
              description: "",
              published: "",
              site: "",
              domain: "example.com",
              extractor_type: null,
            },
          };
        }
        if (message.action === "listExtractors") return { extractorNames: [] };
        if (message.action === "openObsidian") {
          if (typeof message.obsidianUrl !== "string") {
            throw new Error("Expected an Obsidian URL.");
          }
          obsidianUrl = message.obsidianUrl;
          return { ok: true };
        }
        throw new Error(`Unexpected message: ${message.action}`);
      },
    },
  });

  const script = document.createElement("script");
  script.textContent = readerContentScript;
  document.body.append(script);
  messageListener?.({ action: "toggle" });

  await vi.waitFor(() => {
    const host = document.querySelector<HTMLDivElement>('[id^="loupe-reader-host-"]');
    expect(host?.shadowRoot?.querySelector("article h1")?.textContent).toBe("Rendered article");
  });
  const host = document.querySelector<HTMLDivElement>('[id^="loupe-reader-host-"]');
  expect(host).not.toBeNull();
  const shadow = host!.shadowRoot!;
  expect(shadow.querySelector("article")?.textContent).toContain("Readable text.");
  expect(shadow.querySelectorAll(".loupe-reader-outline-item")).toHaveLength(1);

  const menuToggle = shadow.querySelector<HTMLButtonElement>('[data-action="menu-toggle"]')!,
    leftBeforeOpen = menuToggle.getBoundingClientRect().left;
  menuToggle.click();
  expect(shadow.querySelector<HTMLDivElement>(".loupe-reader-menu")?.hidden).toBe(false);
  expect(Math.abs(menuToggle.getBoundingClientRect().left - leftBeforeOpen)).toBeLessThan(0.5);

  shadow.querySelector<HTMLButtonElement>('[data-action="obsidian"]')!.click();
  await vi.waitFor(() => {
    expect(shadow.querySelector(".loupe-reader-status")?.textContent)
      .toContain("Opening in Obsidian; image import will continue there");
  });
  expect(new URL(obsidianUrl).hostname).toBe("loupe-import");
  expect(new URL(obsidianUrl).searchParams.has("content")).toBe(false);
  expect(clipboardText).toContain("![photo](https://example.com/photo.jpg)");

  clipboardShouldFail = true;
  shadow.querySelector<HTMLButtonElement>('[data-action="obsidian"]')!.click();
  await vi.waitFor(() => {
    expect(shadow.querySelector(".loupe-reader-status")?.textContent).toContain("Opening in Obsidian…");
  });
  const fallbackUri = new URL(obsidianUrl);
  expect(fallbackUri.hostname).toBe("new");
  expect(fallbackUri.searchParams.get("content")).toContain("Rendered article");
});
