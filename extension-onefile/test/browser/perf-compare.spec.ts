import { expect, test, type Page } from "playwright/test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglot } from "../../src/polyglot.ts";
import { readStoredArchive } from "../../src/zip.ts";
import { CapturePayloadSchema } from "../../src/message-contract.ts";
import { Schema } from "effect";

const specDirectory = dirname(fileURLToPath(import.meta.url)),
  repoRoot = join(specDirectory, "..", "..", ".."),
  fixtureRoot = join(repoRoot, "extension-onefile", "test", "fixtures"),
  distCapture = join(repoRoot, "dist", "extension-onefile", "inject", "capture.js"),
  distLoader = readFileSync(join(repoRoot, "dist", "extension-onefile", "inject", "loader.js"), "utf8"),
  upstreamRoot = join(repoRoot, ".work", "tmp", "upstream-base", "node_modules", "single-file-core"),
  resultRoot = join(repoRoot, ".work", "tmp", "perf-results");

const onePixelPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x0f, 0x00, 0x01, 0xf6, 0x75, 0x53, 0xbe, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const tinySvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');

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
  ".js": "text/javascript; charset=utf-8",
};

interface FixtureDef {
  name: string;
  path: string;
  marker: string;
}

const fixtures: FixtureDef[] = [
  { name: "small", path: "/fixtures/text-unicode.html", marker: "日本語の本文" },
  { name: "article", path: "/fixtures/article.html", marker: "Paragraph 199" },
  { name: "image-heavy", path: "/fixtures/resources.html", marker: "Mixed resources" },
  { name: "css-heavy", path: "/fixtures/styles.html", marker: "styled text" },
];

function handler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1"),
    pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith("/sfc/")) {
      const body = readFileSync(join(upstreamRoot, pathname.slice("/sfc/".length)));
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(body);
      return;
    }
    if (pathname.startsWith("/fixtures/")) {
      const name = pathname.slice("/fixtures/".length),
        dot = name.lastIndexOf("."),
        mime = mimeByExtension[name.slice(dot)] ?? "application/octet-stream";
      let body: Buffer | string;
      try {
        body = readFileSync(join(fixtureRoot, name), "utf8");
      } catch {
        body = name.endsWith(".svg") ? tinySvg : onePixelPng;
      }
      response.writeHead(200, { "content-type": mime });
      response.end(body);
      return;
    }
    response.writeHead(404);
    response.end("no");
  } catch {
    response.writeHead(500);
    response.end("no");
  }
}

interface RunNumbers {
  side: string;
  fixture: string;
  run: number;
  captureMs: number;
  fetchMs: number;
  buildMs: number;
  totalMs: number;
  bytes: number;
  resources: number;
  unresolved: number;
  heapDelta: number | null;
  error: string | null;
}

async function heapUsed(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
  });
}

async function measureOurs(page: Page, origin: string, fixture: FixtureDef, run: number): Promise<RunNumbers> {
  await page.goto(`${origin}${fixture.path}`);
  await page.addScriptTag({ path: distCapture });
  const heapBefore = await heapUsed(page),
    started = Date.now(),
    raw = await page.evaluate((saveId: string) =>
      (globalThis as unknown as { onefileCapture: (saveId: string, nowMs: number) => Promise<unknown> }).onefileCapture(saveId, 1_700_000_000_000),
    `perf-${run}`),
    capturedAt = Date.now(),
    payload = Schema.decodeUnknownSync(CapturePayloadSchema)(raw),
    fetched = await page.evaluate(async (urls: string[]) => {
      const slots: ({ ok: true; mime: string; base64: string } | { ok: false; reason: string })[] = new Array(urls.length);
      let cursor = 0;
      const encode = (buffer: Uint8Array): string => {
        let binary = "";
        for (let offset = 0; offset < buffer.length; offset += 4096) {
          binary += String.fromCharCode(...buffer.subarray(offset, offset + 4096));
        }
        return btoa(binary);
      };
      async function worker(): Promise<void> {
        while (cursor < urls.length) {
          const index = cursor;
          cursor += 1;
          const url = urls[index] ?? "";
          try {
            const response = await fetch(url);
            if (!response.ok) {
              slots[index] = { ok: false, reason: `HTTP ${response.status}` };
              continue;
            }
            const buffer = new Uint8Array(await response.arrayBuffer());
            slots[index] = {
              ok: true,
              mime: response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream",
              base64: encode(buffer),
            };
          } catch (thrown) {
            slots[index] = { ok: false, reason: thrown instanceof Error ? thrown.message : String(thrown) };
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, () => worker()));
      return slots;
    }, payload.resources.map((resource) => resource.url)),
    fetchedAt = Date.now();
  let pageHtml = payload.pageHtml;
  const zipResources: { name: string; mime: string; data: Uint8Array }[] = [],
    fetchUnresolved: { url: string; reason: string }[] = [];
  fetched.forEach((slot, index) => {
    const reference = payload.resources[index];
    if (!reference) return;
    if (!slot.ok) {
      pageHtml = pageHtml.replaceAll(`onefile-resource-${index}`, "onefile-missing");
      fetchUnresolved.push({ url: reference.url, reason: slot.reason });
      return;
    }
    const name = `resources/${index}.bin`;
    pageHtml = pageHtml.replaceAll(`onefile-resource-${index}`, name);
    zipResources.push({ name, mime: slot.mime, data: new Uint8Array(Buffer.from(slot.base64, "base64")) });
  });
  const archive = buildPolyglot({
    pageHtml,
    loaderSource: distLoader,
    resources: zipResources,
    sourceUrl: payload.pageUrl,
    capturedAtMs: payload.capturedAtMs,
    unresolved: [...payload.unresolved, ...fetchUnresolved],
  });
  const directory = readStoredArchive(archive.fileBytes);
  if (!archive.fileBytes.subarray(0, archive.prefixLength).includes(97)) {
    throw new Error("prefix is empty");
  }
  if (!payload.pageHtml.includes(fixture.marker)) {
    throw new Error(`marker missing for ${fixture.name}`);
  }
  void directory;
  const heapAfter = await heapUsed(page),
    ended = Date.now();
  return {
    side: "onefile",
    fixture: fixture.name,
    run,
    captureMs: capturedAt - started,
    fetchMs: fetchedAt - capturedAt,
    buildMs: ended - fetchedAt,
    totalMs: ended - started,
    bytes: archive.fileBytes.length,
    resources: payload.resources.length,
    unresolved: payload.unresolved.length + fetchUnresolved.length,
    heapDelta: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    error: null,
  };
}

async function measureUpstream(page: Page, origin: string, fixture: FixtureDef, run: number): Promise<RunNumbers> {
  await page.goto(`${origin}${fixture.path}`);
  await page.evaluate(() => {
    const specifier = "/sfc/single-file.js";
    (globalThis as unknown as { __sfcModule?: Promise<unknown> }).__sfcModule = import(specifier);
  });
  const heapBefore = await heapUsed(page),
    started = Date.now();
  let bytes = 0, error: string | null = null;
  try {
    const result = await page.evaluate(async (marker: string) => {
      const module = await (globalThis as unknown as { __sfcModule: Promise<{ getPageData: (options: unknown, init: unknown) => Promise<{ content: unknown }> }> }).__sfcModule;
      const data = await module.getPageData({}, {});
      const text = typeof data.content === "string" ? data.content : "";
      return { length: text.length, hasMarker: text.includes(marker) };
    }, fixture.marker);
    bytes = result.length;
    if (!result.hasMarker || result.length === 0) error = "upstream output failed verification";
  } catch (thrown) {
    error = String(thrown).slice(0, 200);
  }
  const ended = Date.now(),
    heapAfter = await heapUsed(page);
  return {
    side: "upstream",
    fixture: fixture.name,
    run,
    captureMs: ended - started,
    fetchMs: 0,
    buildMs: 0,
    totalMs: ended - started,
    bytes,
    resources: 0,
    unresolved: 0,
    heapDelta: heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
    error,
  };
}

test.describe.configure({ mode: "serial" });

for (const fixture of fixtures) {
  test(`perf ${fixture.name}: alternating onefile vs upstream`, async ({ browser }) => {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address(),
      origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const runs: RunNumbers[] = [];
    try {
      for (let run = 0; run < 5; run++) {
        for (const side of ["ours", "upstream"] as const) {
          const page = await browser.newPage();
          try {
            runs.push(side === "ours" ? await measureOurs(page, origin, fixture, run) : await measureUpstream(page, origin, fixture, run));
          } finally {
            await page.close();
          }
        }
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    mkdirSync(resultRoot, { recursive: true });
    writeFileSync(join(resultRoot, `${fixture.name}.json`), `${JSON.stringify(runs, null, 2)}\n`);
    for (const run of runs) {
      console.log(`PERF ${run.side} ${run.fixture} run${run.run} total=${run.totalMs}ms bytes=${run.bytes} unresolved=${run.unresolved} error=${run.error ?? "none"}`);
      expect(run.error).toBeNull();
    }
  });
}
