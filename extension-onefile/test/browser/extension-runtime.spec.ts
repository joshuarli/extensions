import { test, expect, chromium, type BrowserContext } from "playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const extensionPath = resolve("build/extension-suite");

test("installed suite toggles right-click on a local tab through its worker", async () => {
  const profile = await mkdtemp(resolve(".work/tmp/mv3-profile-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Local fixture</title><p>fixture</p>");
  });
  let context: BrowserContext | undefined;
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    expect(worker.url()).toBe(`chrome-extension://${extensionId}/service-worker.js`);
    expect(extensionId).toMatch(/^[a-p]{32}$/u);
    const fixture = await context.newPage();
    await fixture.goto(`http://127.0.0.1:${address.port}/`);
    expect(await fixture.title()).toBe("Local fixture");
    const browser = context.browser();
    if (!browser) throw new Error("Persistent context has no browser");
    const browserSession = await browser.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const target = targetInfos.find((info) => info.url === fixture.url());
    if (!target) throw new Error("Fixture tab target not found");
    console.log(`Installed MV3 worker: ${worker.url()}; fixture tab: ${target.targetId}`);
    await browserSession.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
    const tabId = await extensionPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      if (tab?.id === undefined) throw new Error("Fixture tab not found");
      return tab.id;
    }, fixture.url());
    const send = (kind: string) => extensionPage.evaluate(
      ({ kind, tabId }) => chrome.runtime.sendMessage({ kind, tabId }), { kind, tabId },
    );
    expect(await send("allow-right-click/status")).toEqual({ status: "" });
    expect(await send("allow-right-click/toggle")).toEqual({ ok: true });
    await expect.poll(() => send("allow-right-click/status")).toEqual({ status: "on" });
    expect(await send("allow-right-click/toggle")).toEqual({ ok: true });
    await expect.poll(() => send("allow-right-click/status")).toEqual({ status: "off" });
  } finally {
    await context?.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true });
  }
});

test("installed suite serves right-click state through a worker restart", async () => {
  const profile = await mkdtemp(resolve(".work/tmp/mv3-lifecycle-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Lifecycle fixture</title><p>fixture</p>");
  });
  let context: BrowserContext | undefined;
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const fixture = await context.newPage();
    await fixture.goto(`http://127.0.0.1:${address.port}/`);
    const browser = context.browser();
    if (!browser) throw new Error("Persistent context has no browser");
    const browserSession = await browser.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const target = targetInfos.find((info) => info.url === fixture.url());
    if (!target) throw new Error("Fixture tab target not found");
    await browserSession.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
    const send = (kind: string) => extensionPage.evaluate(async ({ kind, url }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      if (tab?.id === undefined) throw new Error("Fixture tab not found");
      return chrome.runtime.sendMessage({ kind, tabId: tab.id });
    }, { kind, url: fixture.url() });

    await expect.poll(() => send("allow-right-click/toggle")).toEqual({ ok: true });
    await expect.poll(() => send("allow-right-click/status")).toEqual({ status: "on" });

    // Terminate the worker the way an extension update or idle eviction does; a later message must restart it.
    await worker.evaluate(() => {
      (globalThis as unknown as { lifecycleProbe: number }).lifecycleProbe = 42;
    });
    const targets = await browserSession.send("Target.getTargets");
    const serviceWorker = targets.targetInfos.find((info) => info.type === "service_worker" && info.url === worker.url());
    if (!serviceWorker) throw new Error("Service worker target not found");
    await browserSession.send("Target.closeTarget", { targetId: serviceWorker.targetId });

    await expect.poll(() => send("allow-right-click/status")).toEqual({ status: "on" });
    const liveWorker = context.serviceWorkers()[0];
    if (!liveWorker) throw new Error("The service worker did not restart.");
    expect(await liveWorker.evaluate(() => (globalThis as unknown as { lifecycleProbe?: number }).lifecycleProbe ?? null)).toBeNull();
    await expect.poll(() => send("allow-right-click/toggle")).toEqual({ ok: true });
    await expect.poll(() => send("allow-right-click/status")).toEqual({ status: "off" });
  } finally {
    await context?.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true });
  }
});
