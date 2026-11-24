import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Worker } from "playwright";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SUITE_EXTENSION_PATH = join(REPO_ROOT, "dist", "extension-suite");

export interface ListedExtension {
  readonly id: string;
  readonly path: string;
  readonly enabled: boolean;
}

type Connect = (url: string, options?: { timeout?: number }) => Promise<Browser>;

export function selectSuiteExtension(
  extensions: readonly ListedExtension[],
  path: string,
): string | null {
  return extensions.find((extension) => extension.enabled && resolve(extension.path) === resolve(path))?.id ?? null;
}

function buildSuite(path: string): void {
  if (existsSync(join(path, "manifest.json"))) return;
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "build-extensions.mjs")], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || String(result.error ?? "")).trim().slice(0, 400);
    throw new Error("Could not build the X Archive extension: " + (detail || "build failed") + ". Run `make dist` and retry.");
  }
}

export async function ensureSuiteExtensionOnBrowser(
  browser: Browser,
  path: string = SUITE_EXTENSION_PATH,
): Promise<string> {
  const session = await browser.newBrowserCDPSession();
  let listed: { extensions: ListedExtension[] };
  try {
    listed = await session.send("Extensions.getExtensions") as { extensions: ListedExtension[] };
  } catch (error) {
    throw new Error(
      "This browser cannot load the X Archive extension over CDP (Extensions.getExtensions failed: "
      + (error instanceof Error ? error.message : String(error)) + ").",
    );
  }
  const existing = selectSuiteExtension(listed.extensions, path);
  if (existing) return existing;
  buildSuite(path);
  const loaded = await session.send("Extensions.loadUnpacked", { path }) as { id: string };
  if (!loaded.id) throw new Error("CDP loaded the X Archive extension but returned no extension id.");
  return loaded.id;
}

export async function ensureSuiteExtension(
  cdpUrl: string,
  path: string = SUITE_EXTENSION_PATH,
  connect: Connect = (url, options) => chromium.connectOverCDP(url, options),
): Promise<string> {
  const browser = await connect(cdpUrl, { timeout: 10_000 });
  try {
    return await ensureSuiteExtensionOnBrowser(browser, path);
  } finally {
    await browser.close();
  }
}

export async function suiteWorker(
  context: BrowserContext,
  extensionId: string,
  timeoutMs: number = 5_000,
): Promise<Worker> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().includes(extensionId));
    if (worker) return worker;
    if (Date.now() >= deadline) {
      throw new Error("The X Archive extension (" + extensionId + ") has no running service worker.");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}
