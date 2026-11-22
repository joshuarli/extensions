import { describe, expect, it } from "vitest";
import { watchBrowserClose } from "../src/save.ts";

function fakeBrowser() {
  let closes = 0;
  return {
    browser: { close: async () => { closes += 1; } },
    closes: () => closes,
  };
}

describe("watchBrowserClose", () => {
  it("closes the browser when the signal aborts, once", () => {
    const fake = fakeBrowser();
    const controller = new AbortController();
    const unwatch = watchBrowserClose(fake.browser, controller.signal);
    expect(fake.closes()).toBe(0);
    controller.abort();
    expect(fake.closes()).toBe(1);
    unwatch();
    controller.abort();
    expect(fake.closes()).toBe(1);
  });

  it("closes immediately for an already-aborted signal", () => {
    const fake = fakeBrowser();
    const controller = new AbortController();
    controller.abort();
    watchBrowserClose(fake.browser, controller.signal);
    expect(fake.closes()).toBe(1);
  });

  it("does nothing when no signal is supplied", () => {
    const fake = fakeBrowser();
    watchBrowserClose(fake.browser, undefined);
    expect(fake.closes()).toBe(0);
  });
});
