import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { buildGraphqlUrl, graphqlRequest, RequestFailure } from "../src/api.ts";
import { parseUserId, type Credentials } from "../src/capture.ts";
import type { XSessionProvider } from "../src/session.ts";

const credentials: Credentials = {
  authorization: "Bearer token",
  queryIds: { Bookmarks: "AbC_123" },
  features: { Bookmarks: '{"ok":true}' },
};

function session(twid: string | null, csrf: string | null): XSessionProvider {
  return async () => ({
    userId: twid === null ? null : parseUserId(twid),
    csrfToken: csrf,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function run(
  fetcher: typeof fetch,
  twid: string | null = "u=123",
  csrf: string | null = "csrf-value",
  operation: "Bookmarks" | "BookmarkFoldersSlice" = "Bookmarks",
): Promise<unknown> {
  const originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>)["fetch"] = fetcher;
  const controller = new AbortController();
  return Effect.runPromise(
    graphqlRequest("123", credentials, operation, { count: 100 }, controller.signal, session(twid, csrf)),
  ).finally(() => {
    (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
  });
}

function failureOf(error: unknown): RequestFailure {
  expect(error).toBeInstanceOf(RequestFailure);
  return error as RequestFailure;
}

describe("graphql request edge", () => {
  it("sends the captured query with auth headers and returns data", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [],
      fetcher = (async (url: string, init?: RequestInit) => {
        seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch;
    const data = (await run(fetcher)) as Record<string, Record<string, boolean>>;
    expect(data["data"]).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("/i/api/graphql/AbC_123/Bookmarks?");
    expect(seen[0]?.headers["Authorization"]).toBe("Bearer token");
    expect(seen[0]?.headers["X-Csrf-Token"]).toBe("csrf-value");
  });

  it("maps http failures to failure kinds without retrying here", async () => {
    for (const [status, kind] of [[429, "rate_limit"], [401, "auth"], [403, "auth"], [400, "query"], [500, "network"]] as const) {
      const error = await run(async () => jsonResponse({}, status)).then(
        () => { throw new Error(`HTTP ${status} should fail.`); },
        (error: unknown) => failureOf(error),
      );
      expect(error.kind).toBe(kind);
    }
  });

  it("maps bad payloads and graphql errors to response and query failures", async () => {
    const badJson = await run(async () => new Response("not json")).then(
      () => { throw new Error("Invalid JSON should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(badJson.kind).toBe("response");
    const rateLimited = await run(async () => jsonResponse({ errors: [{ code: 88 }] })).then(
      () => { throw new Error("Rate-limit errors should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(rateLimited.kind).toBe("rate_limit");
    const queryError = await run(async () => jsonResponse({ errors: [{ message: "boom" }] })).then(
      () => { throw new Error("GraphQL errors should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(queryError.kind).toBe("query");
  });

  it("refuses missing credentials, sessions, and stopped requests", async () => {
    const noQuery = await run(async () => jsonResponse({}), "u=123", "csrf-value", "BookmarkFoldersSlice").then(
      () => { throw new Error("Missing query IDs should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(noQuery.kind).toBe("auth");
    const switched = await run(async () => jsonResponse({ data: {} }), "u=999").then(
      () => { throw new Error("Switched accounts should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(switched.kind).toBe("auth");
    const noCsrf = await run(async () => jsonResponse({}), "u=123", null).then(
      () => { throw new Error("Missing CSRF cookies should fail."); },
      (error: unknown) => failureOf(error),
    );
    expect(noCsrf.kind).toBe("auth");
    const controller = new AbortController();
    controller.abort();
    const stopped = await Effect.runPromise(
      graphqlRequest("123", credentials, "Bookmarks", {}, controller.signal, session("u=123", "csrf-value")).pipe(Effect.flip),
    );
    expect(stopped).toBeInstanceOf(RequestFailure);
    expect((stopped as RequestFailure).kind).toBe("stopped");
  });

  it("rejects query ids outside the url path alphabet", () => {
    expect(() => buildGraphqlUrl("../../exploit", "Bookmarks", {}, undefined)).toThrow();
  });
});

describe("fieldToggles and graphql error bodies", () => {
  it("appends fieldToggles only when captured or on renamed timeline operations", () => {
    const withToggles = buildGraphqlUrl("q", "UserOriginalsTimeline", { userId: "1" }, undefined, '{"withPayments":false,"withArticlePlainText":false}');
    expect(withToggles).toContain("fieldToggles=%7B%22withPayments%22%3Afalse%2C%22withArticlePlainText%22%3Afalse%7D");
    const withoutToggles = buildGraphqlUrl("q", "Bookmarks", { count: 100 }, undefined, undefined);
    expect(withoutToggles).not.toContain("fieldToggles=");
    const decoded = new URL(withToggles).searchParams.get("fieldToggles");
    expect(decoded).toBe('{"withPayments":false,"withArticlePlainText":false}');
  });

  it("includes the graphql error message in 422 failures", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = (async () => new Response(
      JSON.stringify({ errors: [{ message: "Variable $withQuickPromoteEligibilityTweetFields of required type Boolean! was not provided." }] }),
      { status: 422, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
    try {
      const outcome = await Effect.runPromise(
        graphqlRequest("123", credentials, "Bookmarks", { count: 100 }, new AbortController().signal, session("u=123", "csrf-value")).pipe(
          Effect.map(() => "ok" as const),
          Effect.catch((error: unknown) => Effect.succeed(error)),
        ),
      );
      expect(outcome).toBeInstanceOf(RequestFailure);
      expect((outcome as RequestFailure).message).toContain("Variable $withQuickPromoteEligibilityTweetFields");
      expect((outcome as RequestFailure).message).toContain("HTTP 422");
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
    }
  });
});
