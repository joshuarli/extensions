import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { CookieInput } from "./session.ts";

const INSTAGRAM_ORIGIN = "https://www.instagram.com/";
const DETACHED = /Target page, context or browser has been closed|Execution context was destroyed|Navigation|Frame was detached/iu;

export interface FetchOutcome {
  readonly status: number;
  readonly text: string;
  readonly retryAfter: string | null;
}

export interface ObservedRequest {
  readonly url: string;
  readonly method: string;
  postData: string | undefined;
}

export interface InstagramPageConnection {
  readonly page: Page;
  cookies(): Promise<readonly CookieInput[]>;
  observe(onRequest: (request: ObservedRequest) => void): () => void;
  capture(url: string, onBytes: (bytes: Uint8Array) => void): () => void;
  reattach(): Promise<Page>;
  close(): Promise<void>;
}

function stopped(): Error {
  return new DOMException("Stopped", "AbortError");
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal?.aborted) throw stopped();
  if (signal === undefined) return operation;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(stopped()); };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

export function pageFetch(connection: InstagramPageConnection, signal?: AbortSignal): {
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchOutcome>;
} {
  let page = connection.page;
  async function run<T>(operation: (target: Page) => Promise<T>): Promise<T> {
    try {
      return await abortable(operation(page), signal);
    } catch (error) {
      if (signal?.aborted || !DETACHED.test(String(error))) throw error;
      page = await connection.reattach();
      return abortable(operation(page), signal);
    }
  }
  return {
    async fetch(url, init) {
      return run((target) => target.evaluate(async ({ requestUrl, requestInit }) => {
        try {
          const response = await fetch(requestUrl, {
            method: requestInit.method ?? "GET",
            credentials: "include",
            ...(requestInit.headers === undefined ? {} : { headers: requestInit.headers }),
            ...(requestInit.body === undefined ? {} : { body: requestInit.body }),
          });
          return {
            status: response.status,
            text: (await response.text()).slice(0, 2_000_000),
            retryAfter: response.headers.get("retry-after"),
          };
        } catch (error) {
          return { status: 0, text: String(error).slice(0, 500), retryAfter: null };
        }
      }, { requestUrl: url, requestInit: init }));
    },
  };
}

export async function connectInstagramPage(cdpUrl: string): Promise<InstagramPageConnection> {
  const browser: Browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15_000 });

  function context(): BrowserContext {
    const found = browser.contexts()[0];
    if (found === undefined) throw new Error("The browser at " + cdpUrl + " has no page context.");
    return found;
  }

  function findPage(): Page | null {
    for (const candidate of context().pages()) {
      if (candidate.url().startsWith(INSTAGRAM_ORIGIN) && !candidate.isClosed()) return candidate;
    }
    return null;
  }

  async function freshPage(): Promise<Page> {
    const created = await context().newPage();
    await created.goto(INSTAGRAM_ORIGIN, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return created;
  }

  let page = findPage() ?? await freshPage();
  return {
    get page() { return page; },
    async cookies() {
      const values = await context().cookies();
      return values.map((cookie: { name: string; value: string; domain: string }) =>
        ({ name: cookie.name, value: cookie.value, domain: cookie.domain }));
    },
    observe(onRequest) {
      const listener = (request: { url(): string; method(): string; postData(): string | null }): void => {
        onRequest({
          url: request.url(),
          method: request.method(),
          postData: request.postData() ?? undefined,
        });
      };
      page.on("request", listener);
      return () => { page.off("request", listener); };
    },
    capture(url, onBytes) {
      const listener = (response: { url(): string; body(): Promise<Buffer> }): void => {
        if (!response.url().startsWith(url)) return;
        void response.body().then(
          (buffer) => { onBytes(new Uint8Array(buffer)); },
          () => {},
        );
      };
      page.on("response", listener);
      return () => { page.off("response", listener); };
    },
    async reattach() {
      page = findPage() ?? await freshPage();
      return page;
    },
    close: () => browser.close(),
  };
}
