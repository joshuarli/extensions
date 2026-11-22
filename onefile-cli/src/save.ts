import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { chromium } from "playwright";
import { build } from "vite";
import { fetchResourceBytes } from "../../extension-onefile/src/fetch-resource.ts";
import { saveTab, type SaveDependencies } from "../../extension-onefile/src/workflow.ts";
import type { SaveOptions } from "./args.ts";
import { resolveBackend } from "./backend.ts";

async function bundle(name: "capture" | "loader"): Promise<string> {
  const result = await build({ configFile: false, logLevel: "silent", build: { write: false, minify: false, target: "chrome120", rolldownOptions: { input: resolve(import.meta.dirname, `../../extension-onefile/src/inject/${name}.ts`), output: { format: "iife" } } } });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap((output) => "output" in output ? output.output : []).find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error(`Could not build ${name} script`);
  return chunk.code;
}

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

export async function save(options: SaveOptions): Promise<string> {
  const [captureScript, loaderScript] = await Promise.all([bundle("capture"), bundle("loader")]);
  const cdpUrl = resolveBackend(options).cdpUrl;
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP browser has no default context");
    const page = await context.newPage();
    try {
      await page.goto(options.url, { waitUntil: "load" });
      await page.evaluate(captureScript);
      const payload: unknown = await page.evaluate(() => globalThis.onefileCapture!("onefile-cli", Date.now()));
      const archive = await assembleCapture(payload, loaderScript);
      await mkdir(options.out, { recursive: true });
      const path = join(options.out, archive.filename);
      await writeFile(path, archive.bytes, { flag: "wx" });
      if (archive.missingCount) process.stderr.write(`Saved with ${archive.missingCount} missing file(s); see archive metadata.\n`);
      return path;
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
