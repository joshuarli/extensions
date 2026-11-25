import type { XSession } from "../../lib/x-session.ts";
import { cookieSession } from "../../lib/x-session.ts";

const FOLLOW_URL = "https://x.com/i/api/1.1/friendships/create.json";

export function followingFromUserLookup(data: unknown): boolean | null {
  const read = (value: unknown, ...keys: string[]): unknown => {
    let result = value;
    for (const key of keys) {
      result = result !== null && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)[key] : undefined;
    }
    return result;
  };
  const following = read(data, "data", "user", "result", "relationship_perspectives", "following");
  return typeof following === "boolean" ? following : null;
}

export interface FollowResult {
  userId: string;
  followed: boolean;
  status: number;
}

function formBody(userId: string): string {
  if (!/^\d+$/u.test(userId)) throw new Error("Invalid X user id.");
  const params = new URLSearchParams({
    include_profile_interstitial_type: "1",
    include_blocking: "1",
    include_blocked_by: "1",
    include_followed_by: "1",
    include_want_retweets: "1",
    include_mute_edge: "1",
    include_can_dm: "1",
    include_can_media_tag: "1",
    include_ext_is_blue_verified: "1",
    include_ext_verified_type: "1",
    include_ext_profile_image_shape: "1",
    skip_status: "1",
    user_id: userId,
  });
  return params.toString();
}

export async function followAccount(
  session: XSession,
  userId: string,
  signal: AbortSignal,
  authorization?: string | undefined,
): Promise<FollowResult> {
  const current = cookieSession(session);
  if (!current.csrfToken) throw new Error("Missing X CSRF cookie. Sign in to X again.");
  const headers: Record<string, string> = {
    ...(authorization ? { Authorization: authorization } : {}),
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
    Origin: "https://x.com",
    Referer: "https://x.com/",
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Csrf-Token": current.csrfToken,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Auth-Type": "OAuth2Session",
    "X-Twitter-Client-Language": "en",
  };
  if (current.cookieHeader) headers["Cookie"] = current.cookieHeader;
  const response = await fetch(FOLLOW_URL, {
    method: "POST",
    headers,
    body: formBody(userId),
    credentials: "include",
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("X rejected the session while following (HTTP " + response.status + "). Sign in again.");
  }
  if (response.status === 429) throw new Error("X rate limited the follow request. Try again later.");
  if (!response.ok) throw new Error("X follow request failed (HTTP " + response.status + ").");
  return { userId, followed: true, status: response.status };
}
