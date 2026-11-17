import { expect, test } from "playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { buildPolyglot } from "../../src/polyglot.ts";
import { originPathName } from "../../src/filename.ts";
import { readStoredArchive, extractStoredEntry } from "../../src/zip.ts";
import { collectModuleSpecifiers } from "../../src/inject/capture.ts";
import { CapturePayloadSchema } from "../../src/message-contract.ts";

const specDirectory = dirname(fileURLToPath(import.meta.url)),
  repoRoot = join(specDirectory, "..", "..", ".."),
  fixtureRoot = join(repoRoot, "extension-onefile", "test", "fixtures"),
  captureSource = join(repoRoot, "build", "extension-suite", "inject", "onefile", "capture.js"),
  loaderSource = readFileSync(join(repoRoot, "build", "extension-suite", "inject", "onefile", "loader.js"), "utf8");

const mimeByExtension: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function startFixtureServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\//u, ""),
        extension = name.slice(name.lastIndexOf("."));
      try {
        const body = readFileSync(join(fixtureRoot, name));
        response.writeHead(200, { "content-type": mimeByExtension[extension] ?? "application/octet-stream" });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end("not found");
      }
    }).listen(0, "127.0.0.1", () => {
      const address = server.address(),
        origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      resolve({ origin, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

function startArchiveServer(archiveBytes: Uint8Array): Promise<{ origin: string; close: () => Promise<void> }> {
  const directory = readStoredArchive(archiveBytes);
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const rawPath = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname),
        path = rawPath.replace(/^\/+/u, "");
      if (path === "") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(Buffer.from(archiveBytes));
        return;
      }
      const entry = directory.entries.find((candidate) => candidate.name === path);
      if (!entry) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      const extension = path.slice(path.lastIndexOf("."));
      response.writeHead(200, { "content-type": mimeByExtension[extension] ?? "application/octet-stream" });
      response.end(Buffer.from(extractStoredEntry(directory, path)));
    }).listen(0, "127.0.0.1", () => {
      const address = server.address(),
        origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      resolve({ origin, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

test("the archive runs the page's own scripts", async ({ page }) => {
  const fixture = await startFixtureServer();
  try {
    await page.goto(`${fixture.origin}/garden.html`);
    await page.addScriptTag({ path: captureSource });
    const raw = await page.evaluate(() =>
      (globalThis as unknown as { onefileCapture: (stamp: string, nowMs: number) => Promise<unknown> })
        .onefileCapture("scripts-render", 1_700_000_000_000),
    );
    const payload = Schema.decodeUnknownSync(CapturePayloadSchema)(raw);
    expect(payload.resources).toContainEqual({ url: `${fixture.origin}/garden-entry.js`, kind: "script" });
    const textDecoder = new TextDecoder(),
      modules: { url: string; name: string; mime: string; data: Uint8Array }[] = [],
      seen = new Set<string>();
    const fetchModule = async (url: string) => {
      const name = originPathName(url);
      if (name === null || seen.has(name)) return;
      seen.add(name);
      const fetched = await page.evaluate(async (target) => {
        const response = await fetch(target);
        return {
          mime: response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream",
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      }, url);
      const data = new Uint8Array(fetched.bytes);
      modules.push({ url, name, mime: fetched.mime, data });
      for (const specifier of collectModuleSpecifiers(textDecoder.decode(data))) {
        let resolved: URL;
        try {
          resolved = new URL(specifier, url);
        } catch {
          continue;
        }
        if (resolved.origin !== new URL(url).origin) continue;
        await fetchModule(resolved.href);
      }
    };
    for (const resource of payload.resources) {
      if (resource.kind === "script") await fetchModule(resource.url);
    }
    let pageHtml = payload.pageHtml;
    for (const [index, resource] of payload.resources.entries()) {
      if (resource.kind !== "script") {
        pageHtml = pageHtml.replaceAll(`onefile-resource-${index}`, modules.find((module) => module.url === resource.url)?.name ?? "");
      }
    }
    const archive = buildPolyglot({
      pageHtml,
      loaderSource,
      resources: modules.map((module) => ({ name: module.name, mime: module.mime, data: module.data })),
      sourceUrl: payload.pageUrl,
      capturedAtMs: payload.capturedAtMs,
      unresolved: [...payload.unresolved],
    });
    const archiveServer = await startArchiveServer(archive.fileBytes);
    try {
      const scriptResponses: Record<string, number> = {},
        pageErrors: string[] = [];
      page.on("response", (response) => {
        const path = new URL(response.url()).pathname;
        if (path !== "/") scriptResponses[path] = response.status();
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await page.goto(`${archiveServer.origin}/`);
      await expect(page.locator("html")).toHaveAttribute("data-startup", "ready");
      await expect(page.locator(".copy")).not.toHaveAttribute("inert", "");
      await expect(page.locator(".copy")).toBeVisible();
      expect(scriptResponses["/garden-entry.js"]).toBe(200);
      expect(scriptResponses["/garden-bloom.js"]).toBe(200);
      expect(pageErrors).toEqual([]);
    } finally {
      await archiveServer.close();
    }
  } finally {
    await fixture.close();
  }
});
