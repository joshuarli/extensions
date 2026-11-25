import { describe, expect, it } from "vitest";
import { connectChatgpt, type ChatgptClientDeps } from "../src/client.ts";
import { ChatgptRequestFailure } from "../src/failures.ts";
import { CHATGPT_OPERATIONS } from "../src/operations.ts";
import type { BytesFetchResult, JsonFetchResult } from "../src/browser.ts";

const SESSION = { user: { id: "acct-1" }, accessToken: "tok-1" };
const FRESH_SESSION = { user: { id: "acct-1" }, accessToken: "tok-2" };
const SESSION_PATH = "/api/auth/session";
const RECORD_PATH = "/backend-api/conversation/abc";
const MEDIA_PATH = "/backend-api/files/file-1/download";

function ok(value: unknown): JsonFetchResult {
  return { ok: true, value };
}

function http(status: number, body = ""): JsonFetchResult {
  return { ok: false, status, body };
}

function bytes(): BytesFetchResult {
  return { ok: true, bytes: new Uint8Array([1, 2, 3]) };
}

class FakeFetch {
  readonly jsonCalls: Array<{ path: string; headers: Record<string, string> | undefined }> = [];
  readonly byteCalls: Array<{ path: string; headers: Record<string, string> | undefined }> = [];
  private readonly jsonRoutes = new Map<string, Array<JsonFetchResult | Error>>();
  private readonly byteRoutes = new Map<string, Array<BytesFetchResult | Error>>();

  addJson(path: string, ...responses: Array<JsonFetchResult | Error>): this {
    this.jsonRoutes.set(path, responses);
    return this;
  }

  addBytes(path: string, ...responses: Array<BytesFetchResult | Error>): this {
    this.byteRoutes.set(path, responses);
    return this;
  }

  async fetchJson(path: string, headers: Record<string, string> | undefined): Promise<JsonFetchResult> {
    this.jsonCalls.push({ path, headers });
    const queue = this.jsonRoutes.get(path);
    if (queue === undefined || queue.length === 0) throw new Error("Unexpected request: " + path);
    const next = queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  async fetchBytes(path: string, headers: Record<string, string> | undefined): Promise<BytesFetchResult> {
    this.byteCalls.push({ path, headers });
    const queue = this.byteRoutes.get(path);
    if (queue === undefined || queue.length === 0) throw new Error("Unexpected media request: " + path);
    const next = queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }
}

function harness(fetch: FakeFetch, sleeps: number[] = []): { deps: ChatgptClientDeps; sleeps: number[]; fetch: FakeFetch } {
  return {
    fetch,
    sleeps,
    deps: {
      fetchJson: (path, headers) => fetch.fetchJson(path, headers),
      fetchBytes: (path, headers) => fetch.fetchBytes(path, headers),
      sleep: async (ms) => { sleeps.push(ms); },
    },
  };
}

describe("connectChatgpt", () => {
  it("reads the session once, guards the account, and serves later session reads from cache", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION))
      .addJson(RECORD_PATH, ok({ mapping: {} }));
    const { deps } = harness(fetch);
    const statuses: string[] = [];

    const client = await connectChatgpt({
      cdpUrl: "http://unused",
      expectedAccountId: "acct-1",
      dependencies: deps,
      onStatus: (message) => { statuses.push(message); },
    });

    expect(client.accountId).toBe("acct-1");
    expect(client.session).toEqual({ accountId: "acct-1", accessToken: "tok-1" });
    expect(client.operations).toEqual(CHATGPT_OPERATIONS);
    expect(await client.transport.getJson(SESSION_PATH)).toEqual(SESSION);
    expect(fetch.jsonCalls).toHaveLength(1);

    await client.transport.getJson(RECORD_PATH);
    expect(fetch.jsonCalls[1]?.headers).toEqual({ Authorization: "Bearer tok-1" });
    expect(statuses).toEqual([]);
    await client.close();
  });

  it("stops before any archive request when the signed-in account changed", async () => {
    const fetch = new FakeFetch().addJson(SESSION_PATH, ok(SESSION));
    const client = connectChatgpt({
      cdpUrl: "http://unused",
      expectedAccountId: "acct-other",
      dependencies: harness(fetch).deps,
    });

    await expect(client).rejects.toMatchObject({ kind: "auth", message: /account changed/i });
    expect(fetch.jsonCalls.map((call) => call.path)).toEqual([SESSION_PATH]);
  });

  it("classifies a changed session response as a shape failure", async () => {
    const fetch = new FakeFetch().addJson(SESSION_PATH, ok({ user: null }));
    await expect(connectChatgpt({ cdpUrl: "http://unused", dependencies: harness(fetch).deps }))
      .rejects.toMatchObject({ kind: "shape", message: /changed shape/i });
  });

  it("treats a signed-out session as an auth failure", async () => {
    const fetch = new FakeFetch().addJson(SESSION_PATH, http(401, "signed out"));
    await expect(connectChatgpt({ cdpUrl: "http://unused", dependencies: harness(fetch).deps }))
      .rejects.toMatchObject({ kind: "auth", message: /not signed in/i });
  });

  it("retries a rate limit with backoff and reports the pause", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION))
      .addJson(RECORD_PATH, http(429, "slow down"), ok({ mapping: {} }));
    const statuses: string[] = [];
    const { deps, sleeps } = harness(fetch);
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: deps, onStatus: (message) => {
      statuses.push(message);
    } });

    await expect(client.transport.getJson(RECORD_PATH)).resolves.toEqual({ mapping: {} });
    expect(sleeps).toEqual([1000]);
    expect(statuses).toEqual([expect.stringContaining("rate limit")]);
  });

  it("reads a fresh session once on 401 and uses its token for the retry", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION), ok(FRESH_SESSION))
      .addJson(RECORD_PATH, http(401, "expired"), ok({ mapping: {} }));
    const { deps } = harness(fetch);
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: deps });

    await expect(client.transport.getJson(RECORD_PATH)).resolves.toEqual({ mapping: {} });
    expect(fetch.jsonCalls.filter((call) => call.path === SESSION_PATH)).toHaveLength(2);
    expect(fetch.jsonCalls.filter((call) => call.path === RECORD_PATH).map((call) => call.headers))
      .toEqual([
        { Authorization: "Bearer tok-1" },
        { Authorization: "Bearer tok-2" },
      ]);
  });

  it("fails with an auth error when the refreshed session is still rejected", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION), ok(FRESH_SESSION))
      .addJson(RECORD_PATH, http(401), http(401));
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: harness(fetch).deps });

    await expect(client.transport.getJson(RECORD_PATH)).rejects.toMatchObject({ kind: "auth" });
  });

  it("stops when the session changes during a refresh", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION), ok({ user: { id: "acct-2" }, accessToken: "tok-2" }))
      .addJson(RECORD_PATH, http(401));
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: harness(fetch).deps });

    await expect(client.transport.getJson(RECORD_PATH)).rejects.toMatchObject({ kind: "auth", message: /changed during the run/i });
  });

  it("retries transport exceptions within the budget and fails after it", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION))
      .addJson(RECORD_PATH, new Error("socket reset"), new Error("socket reset"), new Error("socket reset"));
    const { deps, sleeps } = harness(fetch);
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: deps, maxRetries: 2 });

    await expect(client.transport.getJson(RECORD_PATH)).rejects.toMatchObject({ kind: "transport" });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("applies the same auth policy to media bytes", async () => {
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION), ok(FRESH_SESSION))
      .addBytes(MEDIA_PATH, { ok: false, status: 401, body: "expired" }, bytes());
    const client = await connectChatgpt({ cdpUrl: "http://unused", dependencies: harness(fetch).deps });

    await expect(client.transport.getBytes!(MEDIA_PATH)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch.byteCalls.map((call) => call.headers)).toEqual([
      { Authorization: "Bearer tok-1" },
      { Authorization: "Bearer tok-2" },
    ]);
  });

  it("stops during backoff without starting another request", async () => {
    const controller = new AbortController();
    const fetch = new FakeFetch()
      .addJson(SESSION_PATH, ok(SESSION))
      .addJson(RECORD_PATH, http(429, "slow down"), ok({ mapping: {} }));
    const { deps } = harness(fetch);
    const client = await connectChatgpt({
      cdpUrl: "http://unused",
      signal: controller.signal,
      dependencies: {
        ...deps,
        sleep: async () => { controller.abort(); },
      },
    });

    await expect(client.transport.getJson(RECORD_PATH)).rejects.toMatchObject({ kind: "stopped" });
    expect(fetch.jsonCalls.filter((call) => call.path === RECORD_PATH)).toHaveLength(1);
  });

  it("stops immediately when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = new FakeFetch().addJson(SESSION_PATH, ok(SESSION));

    await expect(connectChatgpt({
      cdpUrl: "http://unused",
      signal: controller.signal,
      dependencies: harness(fetch).deps,
    })).rejects.toMatchObject({ kind: "stopped" });
    expect(fetch.jsonCalls).toHaveLength(0);
  });

  it("exposes a tagged failure callers can narrow", () => {
    const failure = new ChatgptRequestFailure("rate_limit", "slow down");
    expect(failure).toMatchObject({ _tag: "ChatgptRequestFailure", kind: "rate_limit", message: "slow down" });
  });
});
