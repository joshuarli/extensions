import { expect, test } from "playwright/test";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolyglot } from "../../src/polyglot.ts";

const specDirectory = dirname(fileURLToPath(import.meta.url)),
  repoRoot = join(specDirectory, "..", "..", ".."),
  loaderSource = readFileSync(join(repoRoot, "build", "extension-onefile", "inject", "loader.js"), "utf8");

const scratchRoot = join(repoRoot, ".work", "tmp", "browser-artifacts");

const onePixelPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x0f, 0x00, 0x01, 0xf6, 0x75, 0x53, 0xbe, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const savedPage =
  '<!DOCTYPE html><html><head><title>Probe Page</title><style>p{color:green}</style></head><body><p>saved body text</p><img src="resources/0.png"></body></html>';

function buildProbeArchive(): { fileBytes: Uint8Array; filePath: string } {
  const archive = buildPolyglot({
    pageHtml: savedPage,
    loaderSource,
    resources: [{ name: "resources/0.png", mime: "image/png", data: onePixelPng }],
    sourceUrl: "https://example.com/page",
    capturedAtMs: 1_700_000_000_000,
    unresolved: [],
  });
  mkdirSync(scratchRoot, { recursive: true });
  const filePath = join(scratchRoot, `probe-${process.pid}.u.zip.html`);
  writeFileSync(filePath, archive.fileBytes);
  return { fileBytes: archive.fileBytes, filePath };
}

test("loader upgrades images when the archive serves its own bytes", async ({ page }) => {
  const { fileBytes } = buildProbeArchive(),
    externalRequests: string[] = [],
    probeReads: string[] = [];
  let server: Server | null = null;
  const port = await new Promise<number>((resolve) => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(Buffer.from(fileBytes));
    }).listen(0, "127.0.0.1", () => {
      const address = server?.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  try {
    page.on("request", (request) => {
      if (!request.url().startsWith("http")) return;
      externalRequests.push(request.url());
      if (request.resourceType() === "xhr") probeReads.push(request.url());
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/probe.u.zip.html`);
    await expect(page.locator("p", { hasText: "saved body text" })).toBeVisible();
    await expect
      .poll(async () => (await page.locator("img").getAttribute("src")) ?? "", { timeout: 10_000 })
      .toMatch(/^blob:/);
    await expect(page.locator("#onefile-banner")).toBeHidden();
    expect(errors).toEqual([]);
    expect(probeReads).toEqual([`http://127.0.0.1:${port}/probe.u.zip.html`]);
    for (const url of externalRequests) {
      expect(url.startsWith(`http://127.0.0.1:${port}/`)).toBe(true);
    }
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

test("archive opens from file with native text and no external requests", async ({ page }) => {
  const { filePath } = buildProbeArchive(),
    externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http")) externalRequests.push(request.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`file://${filePath}`);
  await expect(page.locator("p", { hasText: "saved body text" })).toBeVisible();
  await expect(page.locator("#onefile-banner")).toBeVisible();
  await expect(page.locator("#onefile-banner")).toContainText("https://example.com/page");
  const imageSrc = await page.locator("img").getAttribute("src");
  expect(imageSrc?.startsWith("data:image/svg+xml")).toBe(true);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
