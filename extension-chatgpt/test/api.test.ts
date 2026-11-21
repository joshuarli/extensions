import { describe, expect, it } from "vitest";
import { CONFIG, createApiClient, createApiState } from "../src/api.ts";
import { TriageError } from "../src/errors.ts";
import { createClock, jsonResponse, listItem } from "./helpers.ts";

type Handler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function harness(handler: Handler, scale = 1) {
  const clock = createClock();
  const state = createApiState();
  const config = { ...CONFIG, requestGap: 0 };
  const client = createApiClient({
    fetch: handler as typeof fetch,
    state,
    now: clock.now,
    sleep: clock.sleep,
    config,
    scale,
  });
  return { clock, state, client };
}

function expectFailure(promise: Promise<unknown>): Promise<TriageError> {
  return promise.then(
    () => { throw new Error("Expected a failure"); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(TriageError);
      return error as TriageError;
    },
  );
}

describe("authenticated ChatGPT client", () => {
  it("keeps the token inside the client and reports only the account", async () => {
    const { client, state } = harness(async () => jsonResponse(200, { accessToken: "t1", user: { id: "u1" } }));
    expect(await client.session()).toEqual({ accountId: "u1" });
    expect(state.token).toBe("t1");
  });

  it("honours Retry-After and retries the same request after waiting", async () => {
    let calls = 0;
    const { client, state } = harness(async (input) => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { detail: "too many" }, { "retry-after": "2" });
      const offset = new URL(String(input), "https://chatgpt.com").searchParams.get("offset");
      return jsonResponse(200, { items: offset === "0" ? [listItem("a")] : [], total: 1 });
    });
    const { chats } = await client.list("active");
    expect(chats.map((chat) => chat.id)).toEqual(["a"]);
    expect(state.strikes).toBe(1);
    expect(state.cooldownUntil).toBeGreaterThan(0);
    expect(calls).toBe(3);
  });

  it("uses the cooldown ladder when Retry-After is absent", async () => {
    const start = 1_700_000_000_000;
    let calls = 0;
    const { client, state } = harness(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(429, { detail: "too many" });
      return jsonResponse(200, { items: [], total: 0 });
    }, 0.001);
    await client.list("active");
    expect(state.strikes).toBe(1);
    expect(state.cooldownUntil - start).toBe(120);
  });

  it("refreshes the token once after a 401 and retries with the new token", async () => {
    const seen: string[] = [];
    const { client, state } = harness(async (input, init) => {
      const path = String(input);
      if (path.includes("/api/auth/session")) {
        return jsonResponse(200, { accessToken: "new", user: { id: "u1" } });
      }
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      seen.push(auth);
      if (auth === "Bearer old") return jsonResponse(401, { detail: "Unauthorized" });
      return jsonResponse(200, { success: true });
    });
    state.token = "old";
    await client.change({ action: "archive", id: "c1" });
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
    expect(state.token).toBe("new");
  });

  it("stops after one expired retry when the refreshed token is still refused", async () => {
    const { client } = harness(async (input) => {
      if (String(input).includes("/api/auth/session")) {
        return jsonResponse(200, { accessToken: "new", user: { id: "u1" } });
      }
      return jsonResponse(403, { detail: "Unauthorized" });
    });
    const failure = await expectFailure(client.change({ action: "delete", id: "c1" }));
    expect(failure.kind).toBe("auth");
  });

  it("refuses to continue when the signed-in account changes", async () => {
    let account = "u1";
    const { client } = harness(async (input) => {
      if (String(input).includes("/api/auth/session")) {
        return jsonResponse(200, { accessToken: "t", user: { id: account } });
      }
      return jsonResponse(200, { success: true });
    });
    expect((await client.session()).accountId).toBe("u1");
    account = "u2";
    const failure = await expectFailure(client.session());
    expect(failure.kind).toBe("auth");
  });

  it("retries transient server errors while listing", async () => {
    let calls = 0;
    const { client } = harness(async (input) => {
      calls += 1;
      if (calls <= 2) return jsonResponse(500, { detail: "server error" });
      const offset = new URL(String(input), "https://chatgpt.com").searchParams.get("offset");
      return jsonResponse(200, { items: offset === "0" ? [listItem("a")] : [], total: 1 });
    });
    const { chats, complete } = await client.list("active");
    expect(chats).toHaveLength(1);
    expect(complete).toBe(true);
    expect(calls).toBe(4);
  });

  it("refuses a list that does not look like ChatGPT's", async () => {
    const { client } = harness(async () => jsonResponse(200, { items: [{ title: "no id" }], total: 1 }));
    const failure = await expectFailure(client.list("active"));
    expect(failure.kind).toBe("compat");
  });

  it("reports a list as incomplete when ChatGPT returns fewer chats than its total", async () => {
    const { client } = harness(async (input) => {
      const offset = new URL(String(input), "https://chatgpt.com").searchParams.get("offset");
      return jsonResponse(200, { items: offset === "0" ? [listItem("a")] : [], total: 5 });
    });
    const list = await client.list("active");
    expect(list).toMatchObject({ complete: false, total: 5 });
  });

  it("reports a list as incomplete when a page only repeats chats already seen", async () => {
    const { client } = harness(async () => jsonResponse(200, { items: [listItem("a")], total: null }));
    expect((await client.list("active")).complete).toBe(false);
  });

  it("refuses to probe a record whose shape it doesn't recognize", async () => {
    const { client } = harness(async () => jsonResponse(200, { title: "a" }));
    expect((await expectFailure(client.probe("c1"))).kind).toBe("compat");
  });

  it("treats an explicit success:false as a failed change", async () => {
    const { client } = harness(async () => jsonResponse(200, { success: false }));
    const failure = await expectFailure(client.change({ action: "delete", id: "c1" }));
    expect(failure.kind).toBe("http");
  });
});
