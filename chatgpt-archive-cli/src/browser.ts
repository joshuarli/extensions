import { chromium, type Browser, type Page } from "playwright";
import type { ChatgptTransport } from "../../chatgpt-archive-core/src/index.ts";

const CHATGPT_ORIGIN = "https://chatgpt.com/";

type FetchResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly body: string };

export function createPageTransport(page: Page): ChatgptTransport {
  return {
    async getJson(path, headers) {
      const result: FetchResult = await page.evaluate(async ({ requestPath, requestHeaders }) => {
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
      if (!result.ok) {
        const detail = result.body.replace(/\s+/g, " ").trim();
        throw new Error(`ChatGPT request ${path} failed (HTTP ${result.status})${detail ? `: ${detail}` : "."}`);
      }
      return result.value;
    },
  };
}

export interface ChatgptConnection {
  readonly page: Page;
  close(): Promise<void>;
}

export async function connectChatgpt(cdpUrl: string): Promise<ChatgptConnection> {
  const browser: Browser = await chromium.connectOverCDP(cdpUrl);
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().startsWith(CHATGPT_ORIGIN)) {
        return { page, close: () => browser.close() };
      }
    }
  }
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = await context.newPage();
  await page.goto(CHATGPT_ORIGIN, { waitUntil: "domcontentloaded" });
  return { page, close: () => browser.close() };
}
