import { chromium } from "playwright";
import { Schema } from "effect";
import { captureRequest, mergeCapture, type Credentials, type Operation } from "../../x-archive-core/src/capture.ts";

const Headers = Schema.Record(Schema.String, Schema.String);
const RequestEvent = Schema.Struct({
  requestId: Schema.String,
  documentURL: Schema.String,
  request: Schema.Struct({ url: Schema.String, headers: Headers }),
});
const ExtraEvent = Schema.Struct({ requestId: Schema.String, headers: Headers });

type Request = Schema.Schema.Type<typeof RequestEvent>;

export class NetworkCaptures {
  private readonly requests = new Map<string, Request>();
  private readonly extras = new Map<string, Record<string, string>>();
  private current: Credentials = { queryIds: {}, features: {} };

  request(value: unknown): void {
    const event = Schema.decodeUnknownOption(RequestEvent)(value);
    if (event._tag === "None") return;
    const request = event.value;
    if (!request.request.url.startsWith("https://x.com/i/api/graphql/")) return;
    if (this.requests.size >= 256) this.requests.delete(this.requests.keys().next().value!);
    this.requests.set(request.requestId, request);
    this.capture(request.requestId);
  }

  extra(value: unknown): void {
    const event = Schema.decodeUnknownOption(ExtraEvent)(value);
    if (event._tag === "None") return;
    if (this.extras.size >= 256) this.extras.delete(this.extras.keys().next().value!);
    this.extras.set(event.value.requestId, event.value.headers);
    this.capture(event.value.requestId);
  }

  private capture(id: string): void {
    const request = this.requests.get(id);
    if (!request) return;
    let origin: string;
    try { origin = new URL(request.documentURL).origin; } catch { return; }
    const headers = { ...request.request.headers, ...this.extras.get(id) };
    const capture = captureRequest(request.request.url, origin,
      Object.entries(headers).map(([name, value]) => ({ name, value })));
    if (capture) this.current = mergeCapture(this.current, capture);
    if (this.extras.has(id)) { this.requests.delete(id); this.extras.delete(id); }
  }

  credentials(): Credentials { return this.current; }
}

export function recipe(credentials: Credentials): Credentials {
  return { queryIds: credentials.queryIds, features: credentials.features,
    ...(credentials.fieldToggles ? { fieldToggles: credentials.fieldToggles } : {}) };
}

export function reuseRecipe(cached: Credentials, observed: Credentials): Credentials {
  return { ...recipe(cached), ...(observed.authorization ? { authorization: observed.authorization } : {}),
    ...(observed.clientUuid ? { clientUuid: observed.clientUuid } : {}),
    ...(observed.transactionId ? { transactionId: observed.transactionId } : {}) };
}

export async function discover(cdpUrl: string, cached: Credentials | null, required: readonly Operation[]): Promise<Credentials> {
  let browser;
  try { browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10_000 }); }
  catch { throw new Error("Could not attach to the browser for X discovery."); }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser has no context for X discovery.");
    const page = await context.newPage();
    try {
      const cdp = await context.newCDPSession(page);
      const captures = new NetworkCaptures();
      cdp.on("Network.requestWillBeSent", (event) => captures.request(event));
      cdp.on("Network.requestWillBeSentExtraInfo", (event) => captures.extra(event));
      await cdp.send("Network.enable");
      const navigate = async (url: string) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
        await page.waitForTimeout(4000);
      };
      await navigate("https://x.com/i/bookmarks");
      if (!cached) {
        const link = await page.locator('a[href*="/i/bookmarks/"]:not([href$="/likes"]), a[href*="/i/history/"]:not([href$="/likes"])').first().getAttribute("href", { timeout: 3000 }).catch(() => null);
        if (link && /^\/i\/(?:bookmarks|history)\/[A-Za-z0-9_-]+$/u.test(link) && !link.endsWith("/likes")) await navigate("https://x.com" + link);
        await navigate("https://x.com/i/history/likes");
      }
      const observed = captures.credentials();
      if (!observed.authorization) throw new Error("X discovery did not observe authorization; check the signed-in X session.");
      const combined = cached ? reuseRecipe(cached, observed) : observed;
      const missing = required.filter((operation) => !combined.queryIds[operation]);
      if (missing.length) throw new Error("X discovery incomplete; missing operations: " + missing.join(", ") + ".");
      return combined;
    } finally { await page.close(); }
  } finally { await browser.close(); }
}
