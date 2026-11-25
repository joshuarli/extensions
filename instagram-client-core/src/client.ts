import { resolveBackend } from "../../instagram-archive-cli/src/backend.ts";
import {
  connectInstagramPage,
  pageFetch,
  type FetchOutcome,
  type InstagramPageConnection,
  type ObservedRequest,
} from "./browser.ts";
import { captureProfileQuery, queryBody, type ProfileSession } from "./capture.ts";
import { InstagramRequestFailure, parksJob } from "./failures.ts";
import { parseDashTracks, shortcodeToMediaId } from "./hq.ts";
import { parsePostMedia, PostMediaUnavailable, type PageMedia } from "./post-media.ts";

export type { PageMedia } from "./post-media.ts";
export { PostMediaUnavailable } from "./post-media.ts";
import { GRAPHQL_PATH, INSTAGRAM_OPERATIONS, followingPath, mediaInfoPath, profileInfoPath, SAVED_PATH } from "./operations.ts";
import { sessionFromCookies, sessionHeaders, type CookieInput, type InstagramSession } from "./session.ts";

export class MediaTooLarge extends Error {
  readonly bytes: number;

  constructor(bytes: number) {
    super("Media exceeds the size limit (" + bytes + " bytes).");
    this.bytes = bytes;
    this.name = "MediaTooLarge";
  }
}

export interface InstagramClientDeps {
  cookies(): Promise<readonly CookieInput[]>;
  navigate(url: string): Promise<void>;
  pageText(): Promise<string>;
  onRequest(listener: (request: ObservedRequest) => void): () => void;
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchOutcome>;
  runQuery(docId: string, variables: Record<string, unknown>, friendly: string): Promise<FetchOutcome | undefined>;
  savedShortcodes(username: string | null, signal: AbortSignal): Promise<readonly string[]>;
  postPage(shortcode: string): Promise<readonly PageMedia[]>;
  fetchBytes(url: string, maxBytes?: number, signal?: AbortSignal): Promise<Uint8Array>;
  capture(url: string, onBytes: (bytes: Uint8Array) => void): () => void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface ConnectInstagramOptions {
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  expectedAccountId?: string | undefined;
  signal?: AbortSignal | undefined;
  onStatus?: ((message: string) => void) | undefined;
  dependencies?: Partial<InstagramClientDeps> | undefined;
  maxRetries?: number | undefined;
  retryBaseMs?: number | undefined;
}

export interface ProfilePostsPage {
  readonly posts: readonly unknown[];
  readonly cursor: string | null;
  readonly hasNext: boolean;
}

export interface InstagramClient {
  readonly accountId: string;
  readonly session: InstagramSession;
  readonly operations: typeof INSTAGRAM_OPERATIONS;
  openProfile(username: string, signal?: AbortSignal): Promise<ProfileSession>;
  profilePage(profile: ProfileSession, cursor: string | null, signal?: AbortSignal): Promise<ProfilePostsPage>;
  profileInfo(username: string, signal?: AbortSignal): Promise<string>;
  mediaInfo(mediaId: string, signal?: AbortSignal): Promise<unknown>;
  savedShortcodes(signal?: AbortSignal, username?: string | null): Promise<readonly string[]>;
  postPage(shortcode: string, signal?: AbortSignal): Promise<readonly PageMedia[]>;
  followingPage(userId: string, cursor: string | null, signal?: AbortSignal): Promise<{ readonly users: readonly unknown[]; readonly cursor: string | null }>;
  hqTracks(shortcode: string, signal?: AbortSignal): Promise<{ readonly videoUrl: string; readonly audioUrl: string } | null>;
  mediaBytes(url: string, signal?: AbortSignal, maxBytes?: number): Promise<Uint8Array>;
  capture(url: string, onBytes: (bytes: Uint8Array) => void): () => void;
  close(): Promise<void>;
}

const QUERY_SCRIPT = `async (docId, variables, friendly) => {
  const token = (name) => {
    try {
      const value = require(name);
      return value && typeof value === "object" ? value.token || null : null;
    } catch { return null; }
  };
  const dtsg = token("DTSGInitData");
  const lsd = token("LSD");
  const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]*)/) || [])[1] || null;
  if (!dtsg || !lsd || !csrf) return { status: 0, error: "Instagram page tokens are unavailable", retryAfter: null };
  const body = new URLSearchParams({
    doc_id: docId,
    variables: JSON.stringify(variables),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: friendly,
    server_timestamps: "true",
    fb_dtsg: dtsg,
    lsd
  });
  try {
    const response = await fetch("/api/graphql", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRFToken": csrf,
        "X-FB-Friendly-Name": friendly,
        "X-FB-LSD": lsd,
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "359341"
      },
      body
    });
    const text = await response.text();
    if (!response.ok) return { status: response.status, error: text.slice(0, 500), retryAfter: response.headers.get("retry-after") };
    const payload = JSON.parse(text);
    return { status: response.status, text: JSON.stringify({ status: response.status, data: payload.data || null, errors: payload.errors || [], errorSummary: payload.errorSummary || null }), retryAfter: null };
  } catch (error) { return { status: 0, error: String(error), retryAfter: null }; }
}`;

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new InstagramRequestFailure("stopped", "Stopped by user.", "session"));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new InstagramRequestFailure("stopped", "Stopped by user.", "session"));
    };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterSeconds(value: string | null): number {
  if (value === null || value.trim() === "") return 60;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, (at - Date.now()) / 1000) : 60;
}

function queryVariables(profile: ProfileSession, cursor: string | null): Record<string, unknown> {
  const variables: Record<string, unknown> = { ...profile.query.variables, username: profile.username };
  delete variables["after"];
  delete variables["before"];
  if (cursor !== null) variables["after"] = cursor;
  return variables;
}

export async function connectInstagram(options: ConnectInstagramOptions = {}): Promise<InstagramClient> {
  const resolved = resolveBackend({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
  });
  const signal = options.signal ?? new AbortController().signal;
  const maxRetries = options.maxRetries ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 500;
  const report = options.onStatus ?? (() => {});

  let connection: InstagramPageConnection | undefined;
  if (options.dependencies?.cookies === undefined) {
    connection = await connectInstagramPage(resolved.cdpUrl);
  }
  const fetcher = connection === undefined ? undefined : pageFetch(connection, signal);
  function requirePage(): InstagramPageConnection {
    if (connection === undefined) {
      throw new InstagramRequestFailure("transport", "No Instagram browser connection is available.", "session");
    }
    return connection;
  }
  let session: InstagramSession;
  const deps: InstagramClientDeps = {
    cookies: options.dependencies?.cookies ?? (() => requirePage().cookies()),
    navigate: options.dependencies?.navigate ?? (async (url) => {
      await requirePage().page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }),
    pageText: options.dependencies?.pageText ?? (() => requirePage().page.evaluate(() => document.body.innerText)),
    onRequest: options.dependencies?.onRequest ?? ((listener) => {
      const forward = (request: { url(): string; method(): string; postData(): string | null }): void => {
        listener({
          url: request.url(),
          method: request.method(),
          postData: request.postData() ?? undefined,
        });
      };
      requirePage().page.on("request", forward);
      return () => { requirePage().page.off("request", forward); };
    }),
    fetch: options.dependencies?.fetch ?? (async (url, init) => {
      if (fetcher === undefined) throw new InstagramRequestFailure("transport", "No Instagram fetch is available.", "session");
      return fetcher.fetch(url, init);
    }),
    savedShortcodes: options.dependencies?.savedShortcodes ?? (async (username, requestSignal) => {
      const path = username === null || username === undefined ? SAVED_PATH : "/" + encodeURIComponent(username) + SAVED_PATH;
      await deps.navigate("https://www.instagram.com" + path);
      await requirePage().page.waitForSelector('a[href*="/p/"],a[href*="/reel/"]', { timeout: 10_000 }).catch(() => {});
      const text = await deps.pageText();
      if (/log in|sign in/iu.test(text) && !/saved/iu.test(text)) {
        throw new InstagramRequestFailure("auth", "Instagram saved collection requires a signed-in browser.", "saved");
      }
      const seen = new Set<string>();
      let stale = 0;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "saved");
        const codes = await requirePage().page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]'))
            .map((anchor) => {
              const match = /\/(?:p|reel)\/([A-Za-z0-9_-]+)/u.exec(anchor.getAttribute("href") ?? "");
              return match?.[1] ?? null;
            })
            .filter((code): code is string => code !== null));
        const before = seen.size;
        for (const code of codes) seen.add(code);
        stale = seen.size === before ? stale + 1 : 0;
        if (stale >= 8) break;
        await requirePage().page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await deps.sleep(500, requestSignal);
      }
      return [...seen];
    }),
    postPage: options.dependencies?.postPage ?? (async (shortcode) => {
      await deps.navigate("https://www.instagram.com/p/" + encodeURIComponent(shortcode) + "/");
      const scripts = await requirePage().page.evaluate(() =>
        Array.from(document.querySelectorAll("script[data-sjs]")).map((script) => script.textContent ?? ""));
      const media = parsePostMedia(scripts, shortcode);
      if (media.length === 0) throw new PostMediaUnavailable(shortcode);
      return media;
    }),
    runQuery: options.dependencies?.runQuery ?? (async (docId, variables, friendly) => {
      const result = await requirePage().page.evaluate(
        ({ script, docId: id, variables: values, friendly: name }) => {
          const fn = new Function("return " + script)() as (d: string, v: unknown, f: string) => Promise<unknown>;
          return fn(id, values, name);
        },
        { script: QUERY_SCRIPT, docId, variables, friendly },
      );
      return result === undefined || result === null ? undefined : result as FetchOutcome;
    }),
    fetchBytes: options.dependencies?.fetchBytes ?? (async (url, maxBytes = 0, requestSignal = signal) => {
      const response = await fetch(url, {
        headers: sessionHeaders(session, "https://www.instagram.com/"),
        signal: requestSignal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("HTTP " + response.status);
      }
      const declared = Number(response.headers.get("content-length"));
      if (maxBytes > 0 && Number.isFinite(declared) && declared > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new MediaTooLarge(declared);
      }
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error("empty response body");
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value === undefined) continue;
          if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.download");
          if (maxBytes > 0 && total + value.byteLength > maxBytes) throw new MediaTooLarge(total + value.byteLength);
          chunks.push(value);
          total += value.byteLength;
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }),
    capture: options.dependencies?.capture ?? ((url, onBytes) => requirePage().capture(url, onBytes)),
    sleep: options.dependencies?.sleep ?? abortableSleep,
  };

  try {
    session = sessionFromCookies(await deps.cookies());
    if (options.expectedAccountId !== undefined && session.accountId !== options.expectedAccountId) {
      throw new InstagramRequestFailure("auth",
        "The signed-in Instagram account changed. Expected " + options.expectedAccountId
        + " but found " + session.accountId + ". No data was saved.", "session");
    }
  } catch (error) {
    await connection?.close().catch(() => {});
    throw error;
  }

  async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, operation: string): Promise<FetchOutcome> {
    let attempt = 0;
    for (;;) {
      if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", operation);
      let outcome: FetchOutcome;
      try {
        outcome = await deps.fetch(url, init);
      } catch (error) {
        if (error instanceof InstagramRequestFailure) throw error;
        if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", operation);
        if (attempt >= maxRetries) throw new InstagramRequestFailure("transport", "Instagram request failed: " + String(error), operation);
        await deps.sleep(retryBaseMs * (2 ** attempt++), signal);
        continue;
      }
      if (outcome.status === 429) {
        throw new InstagramRequestFailure("rate_limit",
          "Instagram rate limited " + operation + ". Retry after " + retryAfterSeconds(outcome.retryAfter) + "s.", operation);
      }
      if (outcome.status === 401 || outcome.status === 403) {
        throw new InstagramRequestFailure("auth", "Instagram rejected the session for " + operation + ".", operation);
      }
      if (outcome.status === 0 || outcome.status >= 500) {
        if (attempt >= maxRetries) {
          throw new InstagramRequestFailure("transport", `Instagram ${operation} failed after retries (HTTP ${outcome.status}).`, operation);
        }
        report(`Instagram ${operation} paused after HTTP ${outcome.status}; retrying.`);
        await deps.sleep(retryBaseMs * (2 ** attempt++), signal);
        continue;
      }
      return outcome;
    }
  }

  function json(outcome: FetchOutcome, operation: string): Record<string, unknown> {
    if (outcome.status < 200 || outcome.status >= 300) {
      throw new InstagramRequestFailure("unrecognized", `Instagram ${operation} returned HTTP ${outcome.status}.`, operation);
    }
    let value: unknown;
    try {
      value = JSON.parse(outcome.text);
    } catch {
      throw new InstagramRequestFailure("shape", `Instagram ${operation} returned a non-JSON response.`, operation);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new InstagramRequestFailure("shape", `Instagram ${operation} returned a non-object response.`, operation);
    }
    return value as Record<string, unknown>;
  }

  function authHeadersFor(username: string): Record<string, string> {
    return {
      "X-CSRFToken": session.cookies["csrftoken"] ?? "",
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "359341",
      Referer: "https://www.instagram.com/" + encodeURIComponent(username) + "/",
    };
  }

  async function mediaInfo(mediaId: string, requestSignal: AbortSignal): Promise<unknown> {
    const outcome = await request("https://www.instagram.com" + mediaInfoPath(mediaId), {}, "media.info");
    if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.info");
    return json(outcome, "media.info");
  }

  return {
    accountId: session.accountId,
    session,
    operations: INSTAGRAM_OPERATIONS,
    async openProfile(username, requestSignal = signal) {
      return captureProfileQuery({
        navigate: deps.navigate,
        pageText: deps.pageText,
        onRequest: deps.onRequest,
      }, username, requestSignal);
    },
    async profilePage(profile, cursor, requestSignal = signal) {
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "profile.posts");
      const paged = await deps.runQuery(profile.query.docId, queryVariables(profile, cursor), "PolarisProfilePostsQuery");
      const outcome: FetchOutcome = paged ?? await request("https://www.instagram.com" + GRAPHQL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...authHeadersFor(profile.username) },
        body: queryBody(profile, cursor),
      }, "profile.posts");
      if (outcome.status === 429) {
        throw new InstagramRequestFailure("rate_limit", "Instagram rate limited profile.posts.", "profile.posts");
      }
      const payload = json(outcome, "profile.posts");
      if (payload["status"] === 429) {
        throw new InstagramRequestFailure("rate_limit", "Instagram rate limited profile.posts.", "profile.posts");
      }
      if (payload["status"] !== 200) {
        const errors = Array.isArray(payload["errors"]) ? payload["errors"] : [];
        const detail = errors.map((error) => {
          const value = error as Record<string, unknown>;
          return typeof value["message"] === "string" ? value["message"] : "";
        }).filter((message) => message !== "").slice(0, 2).join("; ");
        throw new InstagramRequestFailure("unrecognized", "Instagram profile query failed: " + (detail || String(payload["errorSummary"] ?? "unknown error")), "profile.posts");
      }
      const data = payload["data"];
      if (data === null || typeof data !== "object") {
        throw new InstagramRequestFailure("shape", "Instagram profile query had no data.", "profile.posts");
      }
      const node = (data as Record<string, unknown>)["xdt_api__v1__feed__user_timeline_graphql_connection"];
      if (node === null || typeof node !== "object") {
        throw new InstagramRequestFailure("shape", "Instagram profile query had no timeline connection.", "profile.posts");
      }
      const edges = (node as Record<string, unknown>)["edges"];
      const pageInfo = (node as Record<string, unknown>)["page_info"];
      if (!Array.isArray(edges) || pageInfo === null || typeof pageInfo !== "object") {
        throw new InstagramRequestFailure("shape", "Instagram profile query had an invalid connection shape.", "profile.posts");
      }
      const info = pageInfo as Record<string, unknown>;
      const hasNext = info["has_next_page"] === true;
      const cursorValue = info["end_cursor"];
      if (typeof info["has_next_page"] !== "boolean" || (cursorValue !== null && typeof cursorValue !== "string")) {
        throw new InstagramRequestFailure("shape", "Instagram profile query had invalid pagination.", "profile.posts");
      }
      return {
        posts: edges.map((edge) => (edge as Record<string, unknown>)["node"]),
        cursor: typeof cursorValue === "string" ? cursorValue : null,
        hasNext,
      };
    },
    async profileInfo(username, requestSignal = signal) {
      const outcome = await request("https://www.instagram.com" + profileInfoPath(username), {}, "profile.info");
      const payload = json(outcome, "profile.info");
      const data = payload["data"] as Record<string, unknown> | undefined;
      const user = data?.["user"] as Record<string, unknown> | undefined;
      const id = user?.["id"];
      if (typeof id !== "string" || id === "") {
        throw new InstagramRequestFailure("shape", "Instagram profile info had no user id.", "profile.info");
      }
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "profile.info");
      return id;
    },
    async mediaInfo(mediaId, requestSignal = signal) {
      return mediaInfo(mediaId, requestSignal);
    },
    async savedShortcodes(requestSignal = signal, username = null) {
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "saved");
      return deps.savedShortcodes(username, requestSignal);
    },
    async postPage(shortcode, requestSignal = signal) {
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.download");
      return deps.postPage(shortcode);
    },
    async followingPage(userId, cursor, requestSignal = signal) {
      const url = "https://www.instagram.com" + followingPath(userId, cursor);
      const outcome = await request(url, { headers: sessionHeaders(session, "https://www.instagram.com/" + userId + "/") }, "following");
      const payload = json(outcome, "following");
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "following");
      const users = Array.isArray(payload["users"]) ? payload["users"] : [];
      const next = payload["next_max_id"];
      return { users, cursor: typeof next === "string" && next !== "" ? next : null };
    },
    async hqTracks(shortcode, requestSignal = signal) {
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.info");
      let mediaId: string;
      try {
        mediaId = shortcodeToMediaId(shortcode);
      } catch {
        return null;
      }
      let payload: Record<string, unknown>;
      try {
        payload = await mediaInfo(mediaId, requestSignal) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof InstagramRequestFailure && parksJob(error) && error.kind !== "unrecognized") throw error;
        return null;
      }
      const items = Array.isArray(payload["items"]) ? payload["items"] : [];
      const item = items[0] as Record<string, unknown> | undefined;
      const manifest = item?.["video_dash_manifest"];
      if (typeof manifest !== "string" || manifest === "") return null;
      return parseDashTracks(manifest);
    },
    async mediaBytes(url, requestSignal = signal, maxBytes = 0) {
      if (requestSignal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.download");
      return deps.fetchBytes(url, maxBytes, requestSignal);
    },
    capture: deps.capture,
    close: async () => {
      await connection?.close().catch((error: unknown) => {
        report("Could not close the Instagram browser connection: " + String(error));
      });
    },
  };
}
