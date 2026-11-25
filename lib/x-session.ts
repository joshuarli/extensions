import { chromium } from "playwright";
import { HELIUM_BACKEND, type Backend } from "./cli.ts";

export interface XSession {
  userId: string;
  cookies: { name: string; value: string }[];
}

export async function readBrowserSession(cdpUrl: string, backend: Backend = HELIUM_BACKEND): Promise<XSession> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
  } catch {
    if (backend.kind === "bctl") {
      throw new Error(
        `The bctl session "${backend.session ?? "xarchive"}" is not reachable at ${cdpUrl}. `
        + "Check `bctl status`; sign in once with `bctl profile login " + (backend.session ?? "xarchive") + "`.",
      );
    }
    throw new Error(
      "Helium is not reachable on " + cdpUrl + ". Start Helium with `~/usr/bin/helium` (remote debugging enabled) and retry.",
    );
  }
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("The browser at " + cdpUrl + " has no context to read cookies from.");
    const cookies = (await context.cookies("https://x.com/")).map(({ name, value }) => ({ name, value }));
    const twid = cookies.find((cookie) => cookie.name === "twid");
    const parse = (value: string | undefined): string | null => {
      try {
        return /^u=(\d+)$/u.exec(decodeURIComponent(value ?? "").replaceAll('"', ""))?.[1] ?? null;
      } catch {
        return null;
      }
    };
    const userId = parse(twid?.value);
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

export function cookieHeader(session: XSession): string {
  return session.cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

export function cookieSession(session: XSession): {
  userId: string | null;
  csrfToken: string | null;
  cookieHeader: string;
} {
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
