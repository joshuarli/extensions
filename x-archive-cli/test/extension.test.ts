import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  SUITE_EXTENSION_PATH,
  ensureSuiteExtension,
  selectSuiteExtension,
} from "../src/extension.ts";

describe("selectSuiteExtension", () => {
  it("picks the enabled extension at the suite path, not a different unpacked extension", () => {
    expect(selectSuiteExtension([
      { id: "other", path: "/somewhere/else", enabled: true },
      { id: "disabled", path: SUITE_EXTENSION_PATH, enabled: false },
      { id: "suite", path: SUITE_EXTENSION_PATH, enabled: true },
    ], SUITE_EXTENSION_PATH)).toBe("suite");
  });

  it("returns null when the suite is not installed", () => {
    expect(selectSuiteExtension([], SUITE_EXTENSION_PATH)).toBeNull();
  });
});

describe("ensureSuiteExtension", () => {
  it("reuses an already loaded suite through the default Playwright connector", async () => {
    const session = {
      send: vi.fn(async (method: string) => method === "Extensions.getExtensions"
        ? { extensions: [{ id: "suite", path: SUITE_EXTENSION_PATH, enabled: true }] }
        : {}),
    };
    const browser = {
      newBrowserCDPSession: vi.fn(async () => session),
      close: vi.fn(async () => {}),
    };
    const connect = vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(browser as never);
    try {
      const id = await ensureSuiteExtension("http://127.0.0.1:9222", SUITE_EXTENSION_PATH);

      expect(id).toBe("suite");
      expect(connect).toHaveBeenCalledOnce();
      expect(session.send.mock.calls.map((call) => call[0])).toEqual(["Extensions.getExtensions"]);
      expect(browser.close).toHaveBeenCalledOnce();
    } finally {
      connect.mockRestore();
    }
  });
});
