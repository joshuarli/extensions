import { chromium, type Browser, type Page } from "playwright";
import { mediaErrorBody } from "../../lib/media.ts";

const CHATGPT_ORIGIN = "https://chatgpt.com/";
const DETACHED = /Target page, context or browser has been closed|Execution context was destroyed|Navigation|Frame was detached/iu;

export type JsonFetchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly body: string };

export type BytesFetchResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly status: number; readonly body: string };

export interface ChatgptPageConnection {
  readonly page: Page;
  reattach(): Promise<Page>;
  close(): Promise<void>;
}

export interface PageFetch {
  fetchJson(path: string, headers: Record<string, string> | undefined): Promise<JsonFetchResult>;
  fetchBytes(path: string, headers: Record<string, string> | undefined): Promise<BytesFetchResult>;
}

function stopped(): Error {
  return new DOMException("Stopped", "AbortError");
}

export function createPageFetch(connection: ChatgptPageConnection, signal?: AbortSignal): PageFetch {
  let page = connection.page;

  async function abortable<T>(run: (target: Page) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw stopped();
    const operation = run(page);
    if (signal === undefined) return operation;
    return await new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(stopped());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  async function retry<T>(run: (target: Page) => Promise<T>): Promise<T> {
    try {
      return await abortable(run);
    } catch (error) {
      if (signal?.aborted || !DETACHED.test(String(error))) throw error;
      page = await connection.reattach();
      return abortable(run);
    }
  }

  return {
    async fetchJson(path, headers) {
      return retry((target) => target.evaluate(async ({ requestPath, requestHeaders }) => {
        try {
          const response = await fetch(requestPath, requestHeaders === undefined
            ? { credentials: "include" }
            : { headers: requestHeaders, credentials: "include" });
          const text = await response.text();
          if (!response.ok) {
            return { ok: false as const, status: response.status, body: text.slice(0, 200) };
          }
          try {
            return { ok: true as const, value: JSON.parse(text) as unknown };
          } catch {
            return { ok: false as const, status: response.status, body: "response is not JSON" };
          }
        } catch (error) {
          return { ok: false as const, status: 0, body: String(error).slice(0, 200) };
        }
      }, { requestPath: path, requestHeaders: headers }));
    },

    async fetchBytes(path, headers) {
      return retry((target) => target.evaluate(async ({ requestPath, requestHeaders }) => {
        try {
          const response = await fetch(requestPath, requestHeaders === undefined
            ? { credentials: "include" }
            : { headers: requestHeaders, credentials: "include" });
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          if (!response.ok) {
            return { ok: false as const, status: response.status, body: new TextDecoder().decode(bytes.slice(0, 200)) };
          }
          const errorBody = mediaErrorBody(bytes);
          if (errorBody !== null) {
            return { ok: false as const, status: response.status, body: errorBody };
          }
          return { ok: true as const, bytes };
        } catch (error) {
          return { ok: false as const, status: 0, body: String(error).slice(0, 200) };
        }
      }, { requestPath: path, requestHeaders: headers }));
    },
  };
}

export async function connectChatgptPage(cdpUrl: string): Promise<ChatgptPageConnection> {
  const browser: Browser = await chromium.connectOverCDP(cdpUrl);

  function findPage(): Page | null {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (candidate.url().startsWith(CHATGPT_ORIGIN) && !candidate.isClosed()) return candidate;
      }
    }
    return null;
  }

  async function freshPage(): Promise<Page> {
    const context = browser.contexts()[0] ?? await browser.newContext();
    const created = await context.newPage();
    await created.goto(CHATGPT_ORIGIN, { waitUntil: "domcontentloaded" });
    return created;
  }

  let page = findPage() ?? await freshPage();
  return {
    get page() { return page; },
    async reattach() {
      page = findPage() ?? await freshPage();
      return page;
    },
    close: () => browser.close(),
  };
}
