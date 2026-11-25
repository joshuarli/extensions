import type { ChatgptTransport, Session } from "../../chatgpt-archive-core/src/index.ts";
import { parseSession } from "../../chatgpt-archive-core/src/schema.ts";
import { resolveBackend } from "../../chatgpt-archive-cli/src/backend.ts";
import {
  connectChatgptPage,
  createPageFetch,
  type BytesFetchResult,
  type ChatgptPageConnection,
  type JsonFetchResult,
} from "./browser.ts";
import { ChatgptRequestFailure } from "./failures.ts";
import { CHATGPT_OPERATIONS, SESSION_PATH, type ChatgptOperation } from "./operations.ts";

export interface ChatgptClientDeps {
  fetchJson(path: string, headers: Record<string, string> | undefined, signal: AbortSignal): Promise<JsonFetchResult>;
  fetchBytes(path: string, headers: Record<string, string> | undefined, signal: AbortSignal): Promise<BytesFetchResult>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface ConnectChatgptOptions {
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  expectedAccountId?: string | undefined;
  signal?: AbortSignal | undefined;
  onStatus?: ((message: string) => void) | undefined;
  dependencies?: Partial<ChatgptClientDeps> | undefined;
  maxRetries?: number | undefined;
  retryBaseMs?: number | undefined;
}

export interface ChatgptClient {
  readonly accountId: string;
  readonly session: Session;
  readonly operations: readonly ChatgptOperation[];
  readonly transport: ChatgptTransport;
  close(): Promise<void>;
}

function combine(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (a === undefined || a === b) return b;
  return AbortSignal.any([a, b]);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new ChatgptRequestFailure("stopped", "Stopped by user."));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ChatgptRequestFailure("stopped", "Stopped by user."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function detail(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean === "" ? "." : `: ${clean}`;
}

export async function connectChatgpt(options: ConnectChatgptOptions = {}): Promise<ChatgptClient> {
  const resolved = resolveBackend({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
  });
  const signal = options.signal ?? new AbortController().signal;
  const maxRetries = options.maxRetries ?? 4;
  const retryBaseMs = options.retryBaseMs ?? 1000;
  const report = options.onStatus ?? (() => {});

  let connection: ChatgptPageConnection | undefined;
  if (options.dependencies?.fetchJson === undefined && options.dependencies?.fetchBytes === undefined) {
    connection = await connectChatgptPage(resolved.cdpUrl);
  }
  const pageFetch = connection === undefined
    ? undefined
    : createPageFetch(connection, signal);
  const deps: ChatgptClientDeps = {
    fetchJson: options.dependencies?.fetchJson ?? (async (path, headers) => {
      if (pageFetch === undefined) throw new ChatgptRequestFailure("transport", "No ChatGPT fetch is available.");
      return pageFetch.fetchJson(path, headers);
    }),
    fetchBytes: options.dependencies?.fetchBytes ?? (async (path, headers) => {
      if (pageFetch === undefined) throw new ChatgptRequestFailure("transport", "No ChatGPT fetch is available.");
      return pageFetch.fetchBytes(path, headers);
    }),
    sleep: options.dependencies?.sleep ?? defaultSleep,
  };

  async function backoff(attempt: number, reason: string, requestSignal: AbortSignal): Promise<void> {
    const wait = retryBaseMs * (2 ** attempt);
    report(`ChatGPT ${reason}; retrying in ${Math.ceil(wait / 1000)}s.`);
    await deps.sleep(wait, requestSignal);
  }

  async function fetchWithBackoff(
    path: string,
    headers: Record<string, string> | undefined,
    requestSignal: AbortSignal,
  ): Promise<JsonFetchResult> {
    let attempt = 0;
    for (;;) {
      if (requestSignal.aborted) throw new ChatgptRequestFailure("stopped", "Stopped by user.");
      let result: JsonFetchResult;
      try {
        result = await deps.fetchJson(path, headers, requestSignal);
      } catch (error) {
        if (error instanceof ChatgptRequestFailure) throw error;
        if (requestSignal.aborted) throw new ChatgptRequestFailure("stopped", "Stopped by user.");
        if (attempt >= maxRetries) {
          throw new ChatgptRequestFailure("transport", "ChatGPT request " + path + " failed: " + String(error));
        }
        await backoff(attempt++, "request failure", requestSignal);
        continue;
      }
      if (!result.ok && result.status === 429) {
        if (attempt >= maxRetries) {
          throw new ChatgptRequestFailure("rate_limit", "ChatGPT rate limit persisted after " + maxRetries + " retries.");
        }
        await backoff(attempt++, "rate limit", requestSignal);
        continue;
      }
      if (!result.ok && (result.status === 0 || result.status >= 500)) {
        if (attempt >= maxRetries) {
          throw new ChatgptRequestFailure("transport", `ChatGPT request ${path} failed after retries (HTTP ${result.status}).`);
        }
        await backoff(attempt++, "server error", requestSignal);
        continue;
      }
      return result;
    }
  }

  async function readSession(requestSignal: AbortSignal): Promise<{ session: Session; raw: unknown }> {
    const result = await fetchWithBackoff(SESSION_PATH, undefined, requestSignal);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        throw new ChatgptRequestFailure("auth",
          "Not signed in to ChatGPT in the attached browser. Sign in at https://chatgpt.com/ and rerun.");
      }
      throw new ChatgptRequestFailure("transport", `ChatGPT session request failed (HTTP ${result.status})${detail(result.body)}`);
    }
    try {
      return { session: parseSession(result.value), raw: result.value };
    } catch (error) {
      throw new ChatgptRequestFailure("shape",
        "ChatGPT session response changed shape: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  let initial: { session: Session; raw: unknown };
  try {
    initial = await readSession(signal);
    if (options.expectedAccountId !== undefined && initial.session.accountId !== options.expectedAccountId) {
      throw new ChatgptRequestFailure("auth",
        "The signed-in ChatGPT account changed. Expected " + options.expectedAccountId
        + " but found " + initial.session.accountId + ". No data was saved.");
    }
  } catch (error) {
    await connection?.close().catch(() => {});
    throw error;
  }
  let session = initial.session;
  let sessionRaw = initial.raw;

  async function refreshSession(requestSignal: AbortSignal): Promise<void> {
    const fresh = await readSession(requestSignal);
    if (fresh.session.accountId !== session.accountId) {
      throw new ChatgptRequestFailure("auth", "The signed-in ChatGPT account changed during the run. No data was saved.");
    }
    session = fresh.session;
    sessionRaw = fresh.raw;
  }

  function authHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    return { ...headers, Authorization: "Bearer " + session.accessToken };
  }

  async function authedFetchJson(
    path: string,
    headers: Record<string, string> | undefined,
    requestSignal: AbortSignal,
  ): Promise<unknown> {
    let result = await fetchWithBackoff(path, authHeaders(headers), requestSignal);
    if (!result.ok && (result.status === 401 || result.status === 403)) {
      report("ChatGPT rejected the session; reading a fresh session and retrying once…");
      await refreshSession(requestSignal);
      result = await fetchWithBackoff(path, authHeaders(headers), requestSignal);
    }
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        throw new ChatgptRequestFailure("auth", "ChatGPT rejected the refreshed session. Sign in again and rerun.");
      }
      if (result.status === 200) {
        throw new ChatgptRequestFailure("shape", `ChatGPT response for ${path} is not JSON.`);
      }
      throw new ChatgptRequestFailure("transport", `ChatGPT request ${path} failed (HTTP ${result.status})${detail(result.body)}`);
    }
    return result.value;
  }

  async function authedFetchBytes(
    path: string,
    headers: Record<string, string> | undefined,
    requestSignal: AbortSignal,
  ): Promise<Uint8Array> {
    let result: BytesFetchResult;
    try {
      result = await deps.fetchBytes(path, authHeaders(headers), requestSignal);
    } catch (error) {
      if (error instanceof ChatgptRequestFailure) throw error;
      if (requestSignal.aborted) throw new ChatgptRequestFailure("stopped", "Stopped by user.");
      throw new ChatgptRequestFailure("transport", "ChatGPT media request " + path + " failed: " + String(error));
    }
    if (!result.ok && (result.status === 401 || result.status === 403)) {
      report("ChatGPT rejected the session for media; reading a fresh session and retrying once…");
      await refreshSession(requestSignal);
      result = await deps.fetchBytes(path, authHeaders(headers), requestSignal);
    }
    if (!result.ok) {
      throw new ChatgptRequestFailure("transport", `ChatGPT media request ${path} failed (HTTP ${result.status})${detail(result.body)}`);
    }
    return result.bytes;
  }

  const transport: ChatgptTransport = {
    async getJson(path, headers, requestSignal) {
      if (path === SESSION_PATH) return sessionRaw;
      return authedFetchJson(path, headers, combine(requestSignal, signal));
    },
    async getBytes(path, headers, requestSignal) {
      return authedFetchBytes(path, headers, combine(requestSignal, signal));
    },
  };

  return {
    accountId: session.accountId,
    session,
    operations: CHATGPT_OPERATIONS,
    transport,
    close: async () => {
      await connection?.close();
    },
  };
}
