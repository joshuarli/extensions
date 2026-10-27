import { expect, test, type Page } from "playwright/test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CapturePayloadSchema } from "../../src/message-contract.ts";
import { Schema } from "effect";

const specDirectory = dirname(fileURLToPath(import.meta.url)),
  repoRoot = join(specDirectory, "..", "..", ".."),
  fixtureRoot = join(repoRoot, "extension-onefile", "test", "fixtures"),
  captureSource = join(repoRoot, "build", "extension-onefile", "inject", "capture.js");

const onePixelPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x0f, 0x00, 0x01, 0xf6, 0x75, 0x53, 0xbe, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const mimeByExtension: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

function fixtureHandler(crossOrigin: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/cross-frame.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!DOCTYPE html><html><body><p>cross frame</p></body></html>");
      return;
    }
    const name = decodeURIComponent(url.pathname).replace(/^\//u, ""),
      dot = name.lastIndexOf("."),
      extension = dot < 0 ? "" : name.slice(dot),
      mime = mimeByExtension[extension] ?? "application/octet-stream";
    let body: Buffer | string;
    try {
      body = readFileSync(join(fixtureRoot, name), "utf8").replaceAll("__CROSS_ORIGIN__", crossOrigin);
    } catch {
      body = onePixelPng;
    }
    response.writeHead(200, { "content-type": mime });
    response.end(body);
  };
}

interface FixtureServers {
  mainOrigin: string;
  crossOrigin: string;
  close: () => Promise<void>;
}

async function startServers(): Promise<FixtureServers> {
  const listen = (handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ server: Server; origin: string }> =>
    new Promise((resolve) => {
      const server = createServer(handler).listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve({ server, origin: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` });
      });
    });
  const cross = await listen(fixtureHandler(""));
  const main = await listen(fixtureHandler(cross.origin));
  return {
    mainOrigin: main.origin,
    crossOrigin: cross.origin,
    close: async () => {
      await new Promise<void>((resolve) => main.server.close(() => resolve()));
      await new Promise<void>((resolve) => cross.server.close(() => resolve()));
    },
  };
}

async function captureFixture(page: Page, url: string) {
  await page.goto(url);
  await page.addScriptTag({ path: captureSource });
  const raw = await page.evaluate(
    ([saveId, nowMs]: [string, number]) =>
      (globalThis as unknown as { onefileCapture: (saveId: string, nowMs: number) => Promise<unknown> }).onefileCapture(saveId, nowMs),
    ["s1", 1_700_000_000_000] as [string, number],
  );
  return Schema.decodeUnknownSync(CapturePayloadSchema)(raw);
}

test.describe("capture corpus", () => {
  let servers: FixtureServers;
  test.beforeAll(async () => {
    servers = await startServers();
  });
  test.afterAll(async () => {
    await servers.close();
  });

  test("unicode page round-trips title and body", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/text-unicode.html`);
    expect(payload.title).toBe("ユニコードのタイトル 🎉 زصف");
    expect(payload.pageHtml).toContain("日本語の本文");
    expect(payload.resources).toEqual([]);
    expect(payload.pageHtml).not.toContain("<script");
  });

  test("mixed images, srcset, lazy, media, and svg", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/resources.html`),
      urls = payload.resources.map((resource) => new URL(resource.url).pathname);
    for (const expected of ["/photo.png", "/photo.jpg", "/anim.gif", "/modern.webp", "/vector.svg", "/responsive.png", "/responsive@2x.png", "/fallback.jpg", "/small.webp", "/large.webp", "/lazy-real.png", "/poster.png", "/my%20photo%20(1).png", "/%C3%BCn%C3%AFcod%C3%A9.png"]) {
      expect(urls).toContain(expected);
    }
    expect(payload.resources.every((resource) => resource.kind === "image")).toBe(true);
    expect(payload.pageHtml).toContain("onefile-resource-");
    expect(payload.pageHtml).not.toContain("lazy-real.png");
    expect(payload.pageHtml).toContain("<circle");
    expect(payload.unresolved.map((item) => item.url)).toEqual(
      expect.arrayContaining(["clip.mp4", "sound.mp3"]),
    );
    expect(payload.pageHtml).not.toContain('src="clip.mp4"');
  });

  test("external stylesheets inline with nested imports and fonts", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/styles.html`);
    expect(payload.pageHtml).not.toContain("<link");
    expect(payload.pageHtml).toContain(".b { color: blue;");
    expect(payload.pageHtml).toContain(".c { color: green;");
    expect(payload.pageHtml).toContain("onefile-resource-");
    expect(payload.pageHtml).not.toContain("/img/a.png");
    expect(payload.resources).toContainEqual(
      expect.objectContaining({ kind: "image", url: expect.stringContaining("/img/a.png") }),
    );
    expect(payload.resources).toContainEqual(
      expect.objectContaining({ kind: "font", url: expect.stringContaining("fonts/served.woff2") }),
    );
    expect(payload.pageHtml).toContain("data:font/woff2;base64,AAAA");
    expect(payload.unresolved).toContainEqual(
      expect.objectContaining({ url: "https://127.0.0.1:1/cross.css", reason: "stylesheet fetch failed" }),
    );
  });

  test("open shadow roots serialize declaratively, closed roots stay put", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/shadow.html`);
    expect(payload.pageHtml).toContain('shadowrootmode="open"');
    expect(payload.pageHtml).toContain("open shadow text");
    expect(payload.pageHtml).toContain("nested shadow text");
    expect(payload.pageHtml).toContain("onefile-resource-");
    expect(payload.pageHtml).toContain('id="closed-host"');
    expect(payload.pageHtml).not.toContain("closed shadow text");
  });

  test("same-origin frames inline as srcdoc, cross-origin frames record", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/frames.html`);
    expect(payload.pageHtml).toContain("inner frame text");
    expect(payload.pageHtml).toContain("deep frame text");
    expect(payload.pageHtml).not.toContain("cross frame");
    expect(payload.pageHtml).not.toContain('src="frame-inner.html"');
    expect(payload.unresolved).toContainEqual(
      expect.objectContaining({ url: `${servers.crossOrigin}/cross-frame.html`, reason: "cross-origin frame" }),
    );
  });

  test("canvas snapshots inline as data urls", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/canvas.html`);
    expect(payload.pageHtml).toContain('<img id="drawn"');
    expect(payload.pageHtml).toContain('src="data:image/png;base64,');
    expect(payload.pageHtml).not.toContain("<canvas");
  });

  test("adopted stylesheets inline", async ({ page }) => {
    const payload = await captureFixture(page, `${servers.mainOrigin}/adopted.html`);
    expect(payload.pageHtml).toContain("data-onefile-adopted");
    expect(payload.pageHtml).toContain(".adopted");
    expect(payload.pageHtml).toContain("onefile-resource-");
  });
});
