import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { chromium, type Page } from "playwright";
import { ONEFILE_CAPTURE_SOURCE, ONEFILE_LOADER_SOURCE } from "../../lib/assets.ts";
import { fetchResourceBytes } from "../../onefile-core/src/fetch-resource.ts";
import { saveTab, type SaveDependencies } from "../../onefile-core/src/workflow.ts";
import type { SaveOptions } from "./args.ts";
import { resolveBackend } from "./backend.ts";

export async function assembleCapture(payload: unknown, loaderSource: string, fetchResource: SaveDependencies["fetchResource"] = fetchResourceBytes): Promise<{ filename: string; bytes: Uint8Array; missingCount: number }> {
  let saved: { filename: string; bytes: Uint8Array } | undefined;
  const outcome = await Effect.runPromise(saveTab({ id: 1 }, {
    executeCapture: async () => payload,
    fetchResource,
    loadLoaderSource: async () => loaderSource,
    downloadBlob: async (blob, filename) => { saved = { filename, bytes: new Uint8Array(await blob.arrayBuffer()) }; return 1; },
    setActionState: async () => {},
    log: () => {},
    nowMs: Date.now,
  }, new Map()));
  if (!saved) throw new Error("Archive was not assembled");
  return { ...saved, missingCount: outcome.missingCount };
}

export function watchBrowserClose(browser: { close(): Promise<void> }, signal: AbortSignal | undefined): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    void browser.close();
    return () => {};
  }
  const close = () => { void browser.close(); };
  signal.addEventListener("abort", close, { once: true });
  return () => signal.removeEventListener("abort", close);
}

export async function save(options: SaveOptions, signal?: AbortSignal): Promise<string> {
  const captureScript = ONEFILE_CAPTURE_SOURCE,
    loaderScript = ONEFILE_LOADER_SOURCE;
  const cdpUrl = resolveBackend(options).cdpUrl;
  const browser = await chromium.connectOverCDP(cdpUrl);
  const unwatch = watchBrowserClose(browser, signal);
  let page: Page | undefined;
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP browser has no default context");
    page = await context.newPage();
    await page.goto(options.url, { waitUntil: "load" });
    await page.evaluate(captureScript);
    const payload: unknown = await page.evaluate(() => globalThis.onefileCapture!("onefile-cli", Date.now()));
    const archive = await assembleCapture(payload, loaderScript);
    await mkdir(options.out, { recursive: true });
    const path = join(options.out, archive.filename);
    await writeFile(path, archive.bytes, { flag: "wx" });
    if (archive.missingCount) process.stderr.write(`Saved with ${archive.missingCount} missing file(s); see archive metadata.\n`);
    return path;
  } finally {
    unwatch();
    if (page && !signal?.aborted) await page.close();
    await browser.close();
  }
}
