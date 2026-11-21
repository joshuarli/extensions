import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

export async function run(options = {}) {
  const root = process.cwd();
  const extensionPath = resolve(root, "dist/extension-suite");
  const scratch = resolve(root, ".work", "tmp");
  mkdirSync(scratch, { recursive: true });
  const samples = [];
  const count = options.samples ?? 5;
  for (let iteration = 0; iteration < count; iteration += 1) {
    const profile = mkdtempSync(join(scratch, "bench-startup-"));
    let context;
    const started = performance.now();
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      const startupMs = Math.round(performance.now() - started);
      if (!worker.url().startsWith("chrome-extension://")) throw new Error("service worker did not start");
      samples.push({ startupMs, work: 1 });
    } finally {
      await context?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }
  return { name: "extension-startup", samples };
}
