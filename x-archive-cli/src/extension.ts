import { resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Worker } from "playwright";
import { materializeExtension, suiteExtensionPath } from "../../lib/assets.ts";

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

export async function ensureSuiteExtensionOnBrowser(
  browser: Browser,
  path: string = suiteExtensionPath(),
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
  const loaded = await session.send("Extensions.loadUnpacked", { path: materializeExtension() }) as { id: string };
  if (!loaded.id) throw new Error("CDP loaded the X Archive extension but returned no extension id.");
  return loaded.id;
}

export async function ensureSuiteExtension(
  cdpUrl: string,
  path: string = suiteExtensionPath(),
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
