import { InstagramRequestFailure } from "./failures.ts";

export interface InstagramSession {
  readonly accountId: string;
  readonly cookies: Readonly<Record<string, string>>;
}

export interface CookieInput {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
}

export function sessionFromCookies(cookies: readonly CookieInput[], operation = "session"): InstagramSession {
  const values: Record<string, string> = {};
  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./u, "");
    if (domain !== "instagram.com" && !domain.endsWith(".instagram.com")) continue;
    if (cookie.name !== "") values[cookie.name] = cookie.value;
  }
  const accountId = values["ds_user_id"];
  if (accountId === undefined || accountId === "" || values["sessionid"] === undefined
      || values["sessionid"] === "" || values["csrftoken"] === undefined || values["csrftoken"] === "") {
    throw new InstagramRequestFailure("auth", "Instagram is not signed in. Sign in at https://www.instagram.com/ in the attached browser.", operation);
  }
  return { accountId, cookies: values };
}

export function sessionHeaders(session: InstagramSession, referer: string): Record<string, string> {
  const cookie = Object.entries(session.cookies)
    .filter(([name, value]) => name !== "" && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => name + "=" + value)
    .join("; ");
  return {
    Accept: "*/*",
    Cookie: cookie,
    Origin: "https://www.instagram.com",
    Referer: referer,
    "X-CSRFToken": session.cookies["csrftoken"]!,
    "X-IG-App-ID": "936619743392459",
    "X-ASBD-ID": "359341",
    "X-IG-WWW-Claim": "0",
    "X-Requested-With": "XMLHttpRequest",
  };
}

const CHECKPOINT = /checkpoint|challenge|verify your account|security check/iu;
const WARNING = /action blocked|automated behavior|spam|temporarily blocked|suspended/iu;

export type PageVerdict = "ok" | "checkpoint" | "warning" | "unrecognized";

export function classifyPage(url: string, text: string, operation: string): PageVerdict {
  if (CHECKPOINT.test(text) || /checkpoint|challenge/iu.test(url)) {
    throw new InstagramRequestFailure("checkpoint", "Instagram presented a security checkpoint.", operation);
  }
  if (WARNING.test(text)) {
    throw new InstagramRequestFailure("warning", "Instagram presented an account warning.", operation);
  }
  if (url.includes("accounts/login")) {
    throw new InstagramRequestFailure("auth", "Instagram redirected to the login page.", operation);
  }
  if (/sorry, this page isn't available|page not found/iu.test(text)) return "unrecognized";
  return "ok";
}
