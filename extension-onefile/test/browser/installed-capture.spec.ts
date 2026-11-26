import { test, expect, chromium, type BrowserContext } from "playwright/test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractStoredEntry, readStoredArchive } from "../../../onefile-core/src/zip.ts";

const extensionPath = resolve("dist/extension-suite");

const onePixelPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x18, 0x8c, 0x02, 0x00, 0x00, 0x0f, 0x00, 0x01, 0xf6, 0x75, 0x53, 0xbe, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

test("installed suite captures a local page and downloads a readable polyglot archive", async () => {
  test.setTimeout(30_000);
  const profile = await mkdtemp(resolve(".work/tmp/mv3-capture-profile-")),
    downloads = await mkdtemp(resolve(".work/tmp/mv3-capture-downloads-"));
  const server = createServer((request, response) => {
    if (request.url === "/image.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(onePixelPng);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><head><title>Installed capture</title></head><body><p>捕获 fixture</p><img src="/image.png"></body></html>');
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
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const browser = context.browser();
    if (!browser) throw new Error("Persistent context has no browser");
    const browserSession = await browser.newBrowserCDPSession();
    await browserSession.send("Browser.setDownloadBehavior", {
      behavior: "allow", downloadPath: downloads, eventsEnabled: true,
    });

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const fixture = await context.newPage();
    await fixture.goto(`http://127.0.0.1:${address.port}/`);
    expect(await fixture.title()).toBe("Installed capture");

    // activeTab access is granted by a user gesture on the fixture tab.
    const { targetInfos } = await browserSession.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const target = targetInfos.find((info) => info.url === fixture.url());
    if (!target) throw new Error("Fixture tab target not found");
    await browserSession.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });

    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect.poll(() => extensionPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      return tab?.id;
    }, fixture.url())).toBeGreaterThan(0);
    const result = await extensionPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      if (tab?.id === undefined) throw new Error("Fixture tab not found");
      return chrome.runtime.sendMessage({ kind: "onefile/save", tabId: tab.id });
    }, fixture.url());
    expect(result).toEqual({ ok: true });

    let downloadPath: string | undefined;
    await expect.poll(async () => {
      downloadPath = await extensionPage.evaluate(async () =>
        (await chrome.downloads.search({ state: "complete" }))[0]?.filename);
      return downloadPath;
    }, { timeout: 20_000 }).toBeTruthy();
    if (!downloadPath) throw new Error("The installed suite did not complete a download.");
    const title = await extensionPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      return tab?.id === undefined ? null : chrome.action.getTitle({ tabId: tab.id });
    }, fixture.url());
    expect(title).toContain(".u.zip.html");

    const bytes = new Uint8Array(await readFile(downloadPath));
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("<html");
    expect(text).toContain("捕获 fixture");
    expect(text).toContain('<script id="onefile-loader">');

    const directory = readStoredArchive(bytes);
    const stored = JSON.parse(new TextDecoder().decode(extractStoredEntry(directory, "metadata.json"))) as {
      sourceUrl: string;
      entries: { name: string; mime: string }[];
    };
    expect(stored.sourceUrl).toBe(fixture.url());
    const image = stored.entries.find((entry) => entry.mime === "image/png");
    if (!image) throw new Error("The installed capture did not archive the fixture image.");
    expect(extractStoredEntry(directory, image.name)).toEqual(new Uint8Array(onePixelPng));
  } finally {
    await context?.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(profile, { recursive: true, force: true });
    await rm(downloads, { recursive: true, force: true });
  }
});

test("installed suite archives an HN comment permalink through the real worker and download transport", async () => {
  const profile = await mkdtemp(resolve(".work/tmp/mv3-hn-profile-")),
    downloads = await mkdtemp(resolve(".work/tmp/mv3-hn-downloads-"));
  let context: BrowserContext | undefined;
  try {
    // Use Chrome's normal download target determiner. CDP's "allow" mode
    // bypasses the extension-suggested filename and derives it from the blob URL.
    const defaults = resolve(profile, "Default");
    await mkdir(defaults, { recursive: true });
    await writeFile(resolve(defaults, "Preferences"), JSON.stringify({
      download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    }));
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true, acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const browser = context.browser();
    if (!browser) throw new Error("Persistent context has no browser");
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.setDownloadBehavior", {
      behavior: "default", eventsEnabled: true,
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    // Replace only the public API network boundary, not the actual extension handler or renderer.
    await worker.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        const prefix = "https://hacker-news.firebaseio.com/v0/item/";
        if (!url.startsWith(prefix)) return original(input, init);
        if (init?.credentials !== "omit" || init.redirect !== "error") throw new Error("Unsafe HN request");
        if (url === prefix + "7.json") return Response.json({ id: 7, type: "story", title: "Fixture HN", kids: [8, 9] });
        if (url === prefix + "8.json") return Response.json({ id: 8, type: "comment", parent: 7, text: "<i>First" });
        if (url === prefix + "9.json") return Response.json({ id: 9, type: "comment", parent: 7, text: "Second" });
        return Response.json(null);
      };
    });
    const url = "https://news.ycombinator.com/item?id=8";
    await context.route(url, (route) => route.fulfill({ contentType: "text/html", body: "<title>HN fixture</title>" }));
    const fixture = await context.newPage();
    await fixture.goto(url);
    const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const target = targetInfos.find((info) => info.url === url);
    if (!target) throw new Error("Fixture tab target not found");
    await session.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const send = (itemId: number) => page.evaluate(async ({ url, itemId }) => {
      const tab = (await chrome.tabs.query({})).find((entry) => entry.url === url);
      if (tab?.id === undefined) throw new Error("HN fixture tab not found");
      return chrome.runtime.sendMessage({ kind: "hackernews/archive", tabId: tab.id, itemId });
    }, { url, itemId });
    expect(await send(7)).toEqual({ ok: false, error: "The active Hacker News item changed; reopen the popup." });
    expect(await page.evaluate(async () => (await chrome.downloads.search({})).length)).toBe(0);
    expect(await send(8)).toEqual({ ok: true });

    let downloadPath: string | undefined;
    await expect.poll(async () => {
      downloadPath = await page.evaluate(async () => (await chrome.downloads.search({ state: "complete" }))[0]?.filename);
      return downloadPath;
    }, { timeout: 20_000 }).toBeTruthy();
    if (!downloadPath) throw new Error("No completed HN archive download");
    expect(downloadPath).toMatch(/hn-7\.html$/u);
    const html = await readFile(downloadPath, "utf8");
    expect(html).toContain("<title>Fixture HN</title>");
    expect(html).toContain("<i>First</i></div></article>");
    expect(html).toContain("Second");
    const data = /<script type="application\/json" id="hn-archive">(.*?)<\/script>/su.exec(html)?.[1];
    if (!data) throw new Error("No structured HN snapshot");
    const archive: unknown = JSON.parse(data);
    expect(archive).toMatchObject({ rootId: 7, requestedId: 8, items: [{ id: 7 }, { id: 8 }, { id: 9 }] });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await rm(downloads, { recursive: true, force: true });
  }
});
