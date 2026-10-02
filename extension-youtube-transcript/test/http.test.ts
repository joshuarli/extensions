import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { cachedFetch, clearResponseCache } from "../src/http.ts";

describe("cachedFetch", () => {
  beforeEach(() => clearResponseCache());

  it("returns cached response on subsequent calls", async () => {
    let calls = 0;
    const fetch = cachedFetch(async (_input) => {
        calls++;
        return new Response(`body-${calls}`, { status: 200 });
      }),
      r1 = await fetch("https://example.com/api");
    assert.equal(await r1.text(), "body-1");
    assert.equal(calls, 1);

    const r2 = await fetch("https://example.com/api");
    assert.equal(await r2.text(), "body-1");
    assert.equal(calls, 1);
  });

  it("evicts non-ok responses and re-fetches", async () => {
    let calls = 0;
    const fetch = cachedFetch(async () => {
        calls++;
        if (calls === 1) return new Response("fail", { status: 500 });
        return new Response("ok", { status: 200 });
      }),
      r1 = await fetch("https://example.com/api");
    assert.equal(r1.status, 500);
    assert.equal(calls, 1);

    const r2 = await fetch("https://example.com/api");
    assert.equal(r2.status, 200);
    assert.equal(calls, 2);
  });

  it("separates cache keys by request body", async () => {
    let calls = 0;
    const fetch = cachedFetch(async (_input, init) => {
        calls++;
        const body = init?.body;
        if (typeof body !== "string") throw new TypeError("Expected a string request body.");
        return new Response(`body-${body}`, { status: 200 });
      }),
      r1 = await fetch("https://example.com/api", { body: "a", method: "POST" });
    assert.equal(await r1.text(), "body-a");
    assert.equal(calls, 1);

    const r2 = await fetch("https://example.com/api", { body: "b", method: "POST" });
    assert.equal(await r2.text(), "body-b");
    assert.equal(calls, 2);

    const r3 = await fetch("https://example.com/api", { body: "a", method: "POST" });
    assert.equal(await r3.text(), "body-a");
    assert.equal(calls, 2);
  });

  it("does not reuse responses for non-string request bodies", async () => {
    let calls = 0;
    const fetch = cachedFetch(async (_input, init) => {
        calls++;
        return new Response(await new Response(init?.body).text(), { status: 200 });
      }),
      firstResponse = await fetch("https://example.com/api", {
        body: new Blob(["first"]),
        method: "POST",
      }),
      secondResponse = await fetch("https://example.com/api", {
        body: new Blob(["second"]),
        method: "POST",
      });

    assert.equal(await firstResponse.text(), "first");
    assert.equal(await secondResponse.text(), "second");
    assert.equal(calls, 2);
  });

  it("deduplicates concurrent requests", async () => {
    let calls = 0;
    const fetch = cachedFetch(async () => {
        calls++;
        return new Response("shared", { status: 200 });
      }),
      [r1, r2] = await Promise.all([
        fetch("https://example.com/api"),
        fetch("https://example.com/api"),
      ]);
    assert.equal(await r1.text(), "shared");
    assert.equal(await r2.text(), "shared");
    assert.equal(calls, 1);
  });

  it("clearResponseCache flushes all cached responses", async () => {
    let calls = 0;
    const fetch = cachedFetch(async () => {
        calls++;
        return new Response("fresh", { status: 200 });
      }),
      r1 = await fetch("https://example.com/api");
    assert.equal(await r1.text(), "fresh");
    assert.equal(calls, 1);

    clearResponseCache();

    const r2 = await fetch("https://example.com/api");
    assert.equal(await r2.text(), "fresh");
    assert.equal(calls, 2);
  });

  it("re-fetches when cached promise rejected", async () => {
    let calls = 0;
    const fetch = cachedFetch(async () => {
      calls++;
      if (calls === 1) throw new Error("network error");
      return new Response("recovered", { status: 200 });
    });

    await assert.rejects(() => fetch("https://example.com/api"), /network error/);
    assert.equal(calls, 1);

    const r2 = await fetch("https://example.com/api");
    assert.equal(await r2.text(), "recovered");
    assert.equal(calls, 2);
  });
});
