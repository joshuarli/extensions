import { expect, test, type Page } from "playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglot } from "../../src/polyglot.ts";
import { CapturePayloadSchema } from "../../src/message-contract.ts";
import { Schema } from "effect";

const specDirectory = dirname(fileURLToPath(import.meta.url)),
  repoRoot = join(specDirectory, "..", "..", ".."),
  captureSource = join(repoRoot, "build", "extension-onefile", "inject", "capture.js"),
  loaderSource = readFileSync(join(repoRoot, "build", "extension-onefile", "inject", "loader.js"), "utf8"),
  scratchRoot = join(repoRoot, ".work", "tmp", "browser-artifacts");

async function captureLive(page: Page): Promise<Schema.Schema.Type<typeof CapturePayloadSchema>> {
  const raw = await page.evaluate(() =>
    (globalThis as unknown as { onefileCapture: (saveId: string, nowMs: number) => Promise<unknown> }).onefileCapture("hardening", 1_700_000_000_000),
  );
  return Schema.decodeUnknownSync(CapturePayloadSchema)(raw);
}

test("deep and wide DOM captures without losing content", async ({ page }) => {
  await page.goto("about:blank");
  await page.evaluate(() => {
    let parent: HTMLElement = document.body;
    for (let depth = 0; depth < 3000; depth++) {
      const child = document.createElement("div");
      child.className = `level-${depth}`;
      parent.append(child);
      parent = child;
    }
    parent.textContent = "deep bottom marker";
    const list = document.createElement("ul");
    for (let index = 0; index < 2000; index++) {
      const item = document.createElement("li");
      item.textContent = `item ${index}`;
      list.append(item);
    }
    document.body.append(list);
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addScriptTag({ path: captureSource });
  const payload = await captureLive(page);
  expect(payload.pageHtml).toContain("deep bottom marker");
  expect(payload.pageHtml).toContain("item 1999");
  expect(errors).toEqual([]);
});

test("css-heavy pages inline imports at scale", async ({ page }) => {
  await page.goto("about:blank");
  await page.evaluate(() => {
    const rules: string[] = [];
    for (let index = 0; index < 2000; index++) {
      rules.push(`.rule-${index}{background:url("https://example.invalid/img/${index}.png")}`);
    }
    for (let index = 0; index < 50; index++) {
      rules.push(`@import url("data:text/css,.imported-${index}{color:red}")`);
    }
    const style = document.createElement("style");
    style.textContent = rules.join("\n");
    document.head.append(style);
    const adopted = new CSSStyleSheet();
    adopted.replaceSync(".adopted-heavy{color:blue}");
    document.adoptedStyleSheets = [adopted];
  });
  await page.addScriptTag({ path: captureSource });
  const payload = await captureLive(page);
  expect(payload.pageHtml).toContain(".imported-49");
  expect(payload.pageHtml).toContain("data-onefile-adopted");
  const urls = payload.resources.map((resource) => resource.url);
  expect(urls).toContain("https://example.invalid/img/0.png");
  expect(urls).toContain("https://example.invalid/img/1999.png");
  expect(payload.resources.length).toBe(2000);
});

test("saved scripts stay dead when the archive opens from file", async ({ page }) => {
  await page.goto("about:blank");
  await page.evaluate(() => {
    document.title = "Counter page";
    document.body.innerHTML = '<p>count <span id="counter">0</span></p><img src="https://example.invalid/dot.png">';
    const tick = document.createElement("script");
    tick.textContent = 'setInterval(() => { const c = document.getElementById("counter"); if (c) c.textContent = String(Number(c.textContent) + 1); }, 25);';
    document.body.append(tick);
  });
  await page.waitForFunction(() => (document.getElementById("counter")?.textContent ?? "0") !== "0");
  await page.addScriptTag({ path: captureSource });
  const payload = await captureLive(page);
  expect(payload.pageHtml).not.toContain("<script");
  const archive = buildPolyglot({
      pageHtml: payload.pageHtml,
      loaderSource,
      resources: [],
      sourceUrl: "about:blank",
      capturedAtMs: 1_700_000_000_000,
      unresolved: [...payload.unresolved],
    });
  mkdirSync(scratchRoot, { recursive: true });
  const filePath = join(scratchRoot, `hardening-scripts-${process.pid}.u.zip.html`);
  writeFileSync(filePath, archive.fileBytes);
  const opened = await page.context().newPage(),
    externalRequests: string[] = [],
    errors: string[] = [];
  opened.on("request", (request) => {
    if (request.url().startsWith("http")) externalRequests.push(request.url());
  });
  opened.on("pageerror", (error) => errors.push(String(error)));
  await opened.goto(`file://${filePath}`);
  const frozen = await opened.locator("#counter").textContent();
  await opened.waitForTimeout(400);
  expect(await opened.locator("#counter").textContent()).toBe(frozen);
  expect(await opened.title()).toBe("Counter page");
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
  await opened.close();
});
