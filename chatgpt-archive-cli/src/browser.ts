import { chromium, type Browser, type Page } from "playwright";
import type { ChatgptTransport } from "../../chatgpt-archive-core/src/index.ts";

const CHATGPT_ORIGIN = "https://chatgpt.com/";

type FetchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly body: string };

const DETACHED = /Target page, context or browser has been closed|Execution context was destroyed|Navigation|Frame was detached/iu;

export interface ChatgptConnection {
  readonly page: Page;
  reattach(): Promise<Page>;
  close(): Promise<void>;
}

export function createPageTransport(connection: ChatgptConnection): ChatgptTransport {
  let page = connection.page;
  async function evaluate(path: string, headers?: Record<string, string>): Promise<FetchResult> {
    return page.evaluate(async ({ requestPath, requestHeaders }) => {
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
    }, { requestPath: path, requestHeaders: headers });
  }
  return {
    async getJson(path, headers) {
      let result: FetchResult;
      try {
        result = await evaluate(path, headers);
      } catch (error) {
        if (!DETACHED.test(String(error))) throw error;
        page = await connection.reattach();
        result = await evaluate(path, headers);
      }
      if (!result.ok) {
        const detail = result.body.replace(/\s+/g, " ").trim();
        throw new Error(`ChatGPT request ${path} failed (HTTP ${result.status})${detail ? `: ${detail}` : "."}`);
      }
      return result.value;
    },
  };
}

export async function connectChatgpt(cdpUrl: string): Promise<ChatgptConnection> {
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
