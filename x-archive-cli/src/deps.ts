import { join } from "node:path";
import { chromium } from "playwright";
import { CredentialsSchema, credentialKey, parseUserId, type Credentials, type ProfileTarget } from "../../x-archive-core/src/capture.ts";
import { Schema } from "effect";
import type { ArchiveDeps } from "../../x-archive-core/src/collector.ts";
import { credentialsCachePath, readJsonFile, writeJsonFile, stateDir } from "./state.ts";

const EXTENSION_ID = "lekmlndhaidgepoalcmbcehffnliclil";
const DEFAULT_CDP_URL = process.env["X_ARCHIVE_CDP_URL"] ?? "http://127.0.0.1:9222";
const CACHE_MAX_AGE_DAYS = 30;

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

export async function readHeliumSession(cdpUrl: string = DEFAULT_CDP_URL): Promise<XSession> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    throw new Error(
      "Helium is not reachable on " + cdpUrl + ". Quit and relaunch it via ~/usr/bin/helium (or pass --cdp-url), then retry.",
    );
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Helium has no browser context to read cookies from.");
    const cookies = (await context.cookies("https://x.com/")).map(({ name, value }) => ({ name, value }));
    const twid = cookies.find((cookie) => cookie.name === "twid");
    const userId = parseUserId(twid?.value);
    if (!userId) {
      throw new Error("Not signed in to X in this Helium (no twid cookie). Sign in to x.com first.");
    }
    return { userId, cookies };
  } finally {
    await browser.close();
  }
}

export async function readCapturedCredentials(session: XSession, cdpUrl: string = DEFAULT_CDP_URL): Promise<Credentials> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 });
  } catch {
    const cached = cachedCredentials();
    if (cached) return cached;
    throw new Error(
      "Helium is not reachable on " + cdpUrl + " and no cached credentials exist yet. Open x.com with the extension loaded, then retry.",
    );
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Helium has no browser context to read extension storage from.");
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
    throw new Error(
      "No captured X credentials found. Open x.com (and the pages you archive: /i/history, /i/history/likes, or the profile) once in Helium with the extension loaded, then retry.",
    );
  } finally {
    await browser.close();
  }
}

function cookieHeader(session: XSession): string {
  return session.cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

export function cookieSession(session: XSession): { userId: string | null; csrfToken: string | null } {
  const ct0 = session.cookies.find((cookie) => cookie.name === "ct0");
  return { userId: session.userId, csrfToken: ct0?.value ?? null };
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

export function defaultCdpUrl(): string {
  return DEFAULT_CDP_URL;
}
