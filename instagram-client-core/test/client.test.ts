import { afterEach, describe, expect, it, vi } from "vitest";
import { connectInstagram, MediaTooLarge, type InstagramClientDeps } from "../src/client.ts";
import { queryBody, type ProfileSession } from "../src/capture.ts";
import { InstagramRequestFailure, parksJob } from "../src/failures.ts";

const COOKIES = [
  { name: "sessionid", value: "session", domain: ".instagram.com" },
  { name: "csrftoken", value: "csrf", domain: ".instagram.com" },
  { name: "ds_user_id", value: "acct-1", domain: ".instagram.com" },
];

const PROFILE: ProfileSession = {
  username: "alice",
  query: { docId: "123", variables: { count: 12 } },
};

function outcome(status: number, payload: unknown): { status: number; text: string; retryAfter: string | null } {
  return { status, text: JSON.stringify(payload), retryAfter: null };
}

function page(edges: unknown[], cursor: string | null, hasNext: boolean) {
  return {
    status: 200,
    text: JSON.stringify({
      status: 200,
      data: {
        xdt_api__v1__feed__user_timeline_graphql_connection: {
          edges,
          page_info: { has_next_page: hasNext, end_cursor: cursor },
        },
      },
    }),
    retryAfter: null,
  };
}

function harness(overrides: Partial<InstagramClientDeps> = {}): InstagramClientDeps {
  return {
    cookies: async () => COOKIES,
    navigate: async () => {},
    pageText: async () => "",
    onRequest: () => () => {},
    fetch: async () => outcome(200, {}),
    savedShortcodes: async () => [],
    postPage: async () => [],
    runQuery: async () => page([{ node: { code: "abc" } }], null, false),
    fetchBytes: async () => new Uint8Array([1, 2]),
    capture: () => () => {},
    sleep: async () => {},
    ...overrides,
  };
}

function harnessWithoutFetchBytes(): Omit<InstagramClientDeps, "fetchBytes"> {
  return {
    cookies: async () => COOKIES,
    navigate: async () => {},
    pageText: async () => "",
    onRequest: () => () => {},
    fetch: async () => outcome(200, {}),
    savedShortcodes: async () => [],
    postPage: async () => [],
    runQuery: async () => page([{ node: { code: "abc" } }], null, false),
    capture: () => () => {},
    sleep: async () => {},
  };
}

describe("connectInstagram", () => {
  it("guards the signed-in account before any archive request", async () => {
    const client = connectInstagram({
      cdpUrl: "http://unused",
      expectedAccountId: "acct-other",
      dependencies: harness(),
    });
    await expect(client).rejects.toMatchObject({ kind: "auth", message: /account changed/i });
  });

  it("fails with auth when the browser is signed out", async () => {
    const client = connectInstagram({
      cdpUrl: "http://unused",
      dependencies: harness({ cookies: async () => [] }),
    });
    await expect(client).rejects.toMatchObject({ kind: "auth", message: /not signed in/i });
  });

  it("pages profile posts and normalizes the connection", async () => {
    const client = await connectInstagram({ cdpUrl: "http://unused", dependencies: harness() });
    const result = await client.profilePage(PROFILE, null);
    expect(result.posts).toEqual([{ code: "abc" }]);
    expect(result.cursor).toBeNull();
    expect(result.hasNext).toBe(false);
  });

  it("passes the cursor into the next page query", async () => {
    let variables: Record<string, unknown> | undefined;
    const client = await connectInstagram({
      cdpUrl: "http://unused",
      dependencies: harness({
        runQuery: async (_docId, values) => {
          variables = values;
          return page([], null, false);
        },
      }),
    });
    await client.profilePage(PROFILE, "cursor-1");
    expect(variables).toMatchObject({ username: "alice", after: "cursor-1" });
  });

  it("classifies a rate limit as parking with a retry hint", async () => {
    const client = await connectInstagram({
      cdpUrl: "http://unused",
      dependencies: harness({ runQuery: async () => outcome(429, {}) }),
    });
    const failure = await client.profilePage(PROFILE, null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InstagramRequestFailure);
    expect(failure).toMatchObject({ kind: "rate_limit", operation: "profile.posts" });
    expect(parksJob(failure as InstagramRequestFailure)).toBe(true);
  });

  it("passes the profile username into saved enumeration", async () => {
    let received: string | null = null;
    const client = await connectInstagram({
      cdpUrl: "http://unused",
      dependencies: harness({
        savedShortcodes: async (username) => { received = username; return []; },
      }),
    });
    await client.savedShortcodes(undefined, "teaandvessel");
    expect(received).toBe("teaandvessel");
  });

  it("fails loudly on a changed response shape", async () => {
    const client = await connectInstagram({
      cdpUrl: "http://unused",
      dependencies: harness({ runQuery: async () => outcome(200, { status: 200, data: {} }) }),
    });
    await expect(client.profilePage(PROFILE, null)).rejects.toMatchObject({ kind: "shape" });
  });

  it("builds a form body with the observed document id", () => {
    const body = new URLSearchParams(queryBody(PROFILE, "cursor-2"));
    expect(body.get("doc_id")).toBe("123");
    expect(body.get("fb_api_req_friendly_name")).toBe("PolarisProfilePostsQuery");
    expect(JSON.parse(body.get("variables") ?? "{}")).toMatchObject({ username: "alice", after: "cursor-2" });
  });

  it("stops before a request when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = await connectInstagram({ cdpUrl: "http://unused", dependencies: harness(), signal: controller.signal });
    await expect(client.profilePage(PROFILE, null)).rejects.toMatchObject({ kind: "stopped" });
  });
});

describe("media size limit", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("skips a declared oversized body before reading it", async () => {
    let read = false;
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      headers: new Headers({ "content-length": "16" }),
      body: {
        getReader: () => { read = true; throw new Error("body should not be read"); },
        cancel: async () => {},
      },
    }));
    const client = await connectInstagram({ cdpUrl: "http://unused", dependencies: harnessWithoutFetchBytes() });
    await expect(client.mediaBytes("https://cdn/media", undefined, 8)).rejects.toBeInstanceOf(MediaTooLarge);
    expect(read).toBe(false);
  });

  it("stops a streamed body as soon as it passes the cap", async () => {
    const chunks = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)];
    let cancelled = false;
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => chunks.length > 0
            ? { done: false, value: chunks.shift() }
            : { done: true, value: undefined },
          cancel: async () => { cancelled = true; },
        }),
        cancel: async () => { cancelled = true; },
      },
    }));
    const client = await connectInstagram({ cdpUrl: "http://unused", dependencies: harnessWithoutFetchBytes() });
    await expect(client.mediaBytes("https://cdn/media", undefined, 6)).rejects.toMatchObject({ bytes: 8 });
    expect(cancelled).toBe(true);
    expect(chunks).toHaveLength(1);
  });

  it("returns the full body when no cap is set", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
    const client = await connectInstagram({ cdpUrl: "http://unused", dependencies: harnessWithoutFetchBytes() });
    expect(Array.from(await client.mediaBytes("https://cdn/media"))).toEqual([1, 2, 3]);
  });
});
