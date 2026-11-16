import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CredentialsSchema, credentialKey, parseUserId, type Credentials, type ProfileTarget } from "../../x-archive-core/src/capture.ts";
import { Schema } from "effect";
import type { ArchiveDeps } from "../../x-archive-core/src/collector.ts";
import { HELIUM_BACKEND, type Backend } from "./backend.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile, stateDir, stateRoot } from "./state.ts";

const EXTENSION_ID = "lekmlndhaidgepoalcmbcehffnliclil";
const CACHE_MAX_AGE_DAYS = 30;
const EXPORT_COOKIES = process.env["X_ARCHIVE_COOKIES_HELPER"]
  ?? join(homedir(), "usr", "dotfiles", "darwin", ".local", "bin", "export-cookies.py");

export interface XSession {
  userId: string;
  cookies: { name: string; value: string }[];
}

interface CachedCredentials {
  queryIds: Record<string, string>;
  features: Record<string, string>;
  fieldToggles?: Record<string, string> | undefined;
  authorization?: string | undefined;
  clientUuid?: string | undefined;
  transactionId?: string | undefined;
  cached_at: string;
}

function cachedCredentials(): CachedCredentials | null {
  const value = readJsonFile(credentialsCachePath());
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["cached_at"] !== "string") return null;
  const ageMs = Date.now() - Date.parse(record["cached_at"]);
  if (!Number.isFinite(ageMs) || ageMs > CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;
  try {
    const { cached_at: _cached, ...rest } = record;
    return { cached_at: record["cached_at"], ...Schema.decodeUnknownSync(CredentialsSchema)(rest) } as CachedCredentials;
  } catch {
    return null;
  }
}

function cacheCredentials(credentials: Credentials): void {
  try {
    writeJsonFile(credentialsCachePath(), { ...credentials, cached_at: new Date().toISOString() });
  } catch { /* The cache is an optimization; never fail the run over it. */ }
}

export function parseNetscapeCookies(text: string, hostname: string): Array<{ name: string; value: string }> {
  const cookies: Array<{ name: string; value: string }> = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const domain = parts[0]!.toLowerCase();
    const name = parts[5]!;
    const value = parts[6]!;
    const host = domain.startsWith(".") ? domain.slice(1) : domain;
    if (host === hostname || host.endsWith("." + hostname)) cookies.push({ name, value });
  }
  return cookies;
}

function cookiesViaExportScript(): Array<{ name: string; value: string }> {
  const workDir = mkdtempSync(join(stateRoot(), "cookies-"));
  try {
    const result = spawnSync("python3", [EXPORT_COOKIES, "helium", "x.com"], {
      cwd: workDir,
      timeout: 60_000,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        "export-cookies.py failed (exit " + String(result.status) + "): "
        + (result.stderr || result.stdout || "unknown error").trim().slice(0, 300)
        + ". If macOS asked to allow access to the Helium Storage Key, allow it and retry.",
      );
    }
    return parseNetscapeCookies(readFileSync(join(workDir, "cookies-x.com.txt"), "utf8"), "x.com");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function readBrowserSession(cdpUrl: string, backend: Backend = HELIUM_BACKEND): Promise<XSession> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    if (backend.kind === "bctl") {
      throw new Error(
        `The bctl session "${backend.session ?? "xarchive"}" is not reachable at ${cdpUrl}. `
        + "Check `bctl status`; sign in once with `bctl profile login " + (backend.session ?? "xarchive") + "`.",
      );
    }
    const cookies = cookiesViaExportScript();
    const twid = cookies.find((cookie) => cookie.name === "twid");
    const userId = parseUserId(twid?.value);
    if (!userId) {
      throw new Error(
        "Helium is not reachable on " + cdpUrl + " and export-cookies.py found no x.com session. "
        + "Quit and relaunch Helium via ~/usr/bin/helium, or sign in to x.com first.",
      );
    }
    return { userId, cookies };
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no context to read cookies from.");
    const cookies = (await context.cookies("https://x.com/")).map(({ name, value }) => ({ name, value }));
    const twid = cookies.find((cookie) => cookie.name === "twid");
    const userId = parseUserId(twid?.value);
    if (!userId) {
      throw new Error(backend.kind === "bctl"
        ? `Not signed in to X in the bctl session "${backend.session ?? "xarchive"}". Run \`bctl profile login ${backend.session ?? "xarchive"}\` once, then retry.`
        : "Not signed in to X in this Helium (no twid cookie). Sign in to x.com first.");
    }
    return { userId, cookies };
  } finally {
    await browser.close();
  }
}

export async function readCapturedCredentials(session: XSession, cdpUrl: string, backend: Backend = HELIUM_BACKEND): Promise<Credentials> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    const cached = cachedCredentials();
    if (cached) return cached;
    throw new Error(backend.kind === "bctl"
      ? `The bctl session "${backend.session ?? "xarchive"}" is not reachable at ${cdpUrl} and no cached credentials exist yet. Check \`bctl status\`.`
      : "Helium is not reachable on " + cdpUrl + " and no cached credentials exist yet. Open x.com with the extension loaded, then retry.");
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no context to read extension storage from.");
    const worker = context.serviceWorkers().find((worker) => worker.url().includes(EXTENSION_ID));
    const key = credentialKey(session.userId);
    const raw = worker
      ? await worker.evaluate(async (storageKey: string) => {
          const all = await chrome.storage.local.get(storageKey);
          return all[storageKey] ?? null;
        }, key).catch(() => null)
      : null;
    const fromBrowser = raw ? Schema.decodeUnknownSync(CredentialsSchema)(raw) : null;
    if (fromBrowser && Object.keys(fromBrowser.queryIds).length > 0 && fromBrowser.authorization) {
      cacheCredentials(fromBrowser);
      return fromBrowser;
    }
    const cached = cachedCredentials();
    if (cached) return cached;
    throw new Error(backend.kind === "bctl"
      ? `The bctl session "${backend.session ?? "xarchive"}" has no X Archive extension and no cached credentials exist yet. Run the CLI once from a signed-in Helium to seed the cache (X_ARCHIVE_BACKEND=helium x download self), then retry.`
      : "No captured X credentials found. Open x.com (and the pages you archive: /i/history, /i/history/likes, or the profile) once in Helium with the extension loaded, then retry.");
  } finally {
    await browser.close();
  }
}

function cookieHeader(session: XSession): string {
  return session.cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

export function cookieSession(session: XSession): { userId: string | null; csrfToken: string | null; cookieHeader: string } {
  const ct0 = session.cookies.find((cookie) => cookie.name === "ct0");
  return { userId: session.userId, csrfToken: ct0?.value ?? null, cookieHeader: cookieHeader(session) };
}

export function cookieHeaders(session: XSession): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    Referer: "https://x.com/",
    Cookie: cookieHeader(session),
  };
}

export function buildDeps(session: XSession, credentials: Credentials): ArchiveDeps {
  const bindingPath = join(stateDir(session.userId), "profile-targets.json");
  const readBinding = (): Record<string, ProfileTarget> => {
    const value = readJsonFile(bindingPath);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, ProfileTarget>
      : {};
  };
  return {
    credentials: async () => credentials,
    currentUserId: async () => session.userId,
    readProfileTarget: async (userId: string) => {
      if (userId !== session.userId) return null;
      const binding = readBinding()["current"];
      return binding ?? null;
    },
    writeProfileTarget: async (userId: string, target: ProfileTarget) => {
      if (userId !== session.userId) return;
      writeJsonFile(bindingPath, { current: target });
    },
    session: async () => cookieSession(session),
  };
}


