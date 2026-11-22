import { describe, expect, it } from "vitest";
import { CONFIG, createApiClient, createApiState } from "../src/api.ts";
import { TriageError } from "../src/errors.ts";
import { isApiRequest, type ApiRequest } from "../src/messages.ts";
import type { Command } from "../src/model.ts";
import { createOperator } from "../src/operator.ts";
import { MAX_ATTEMPTS_PER_CHAT, MutationGuard, requiresTypedConfirmation } from "../src/safety.ts";
import { createClock, jsonResponse } from "./helpers.ts";

function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof TriageError ? error.message : String(error);
  }
}

describe("mutation guard", () => {
  it("is disarmed by default", () => {
    const guard = new MutationGuard();
    expect(refusal(() => guard.authorize("run-1", "u1", "c1"))).toContain("No authorized run");
    expect(refusal(() => guard.authorize("", "u1", "c1"))).toContain("No authorized run");
  });

  it("hands back exactly the armed command, bound to run, account and chat", () => {
    const guard = new MutationGuard();
    guard.arm("run-1", "u1", [{ action: "archive", id: "c1" }, { action: "rename", id: "c2", title: "New" }]);
    expect(guard.authorize("run-1", "u1", "c1")).toEqual({ action: "archive", id: "c1" });
    expect(guard.authorize("run-1", "u1", "c2")).toEqual({ action: "rename", id: "c2", title: "New" });
    expect(refusal(() => guard.authorize("run-1", "u1", "c3"))).toContain("not authorized");
    expect(refusal(() => guard.authorize("run-2", "u1", "c1"))).toContain("No authorized run");
    expect(refusal(() => guard.authorize("run-1", "u2", "c1"))).toContain("different account");
  });

  it("refuses every chat but the marked ones when asked to delete all 200", () => {
    const guard = new MutationGuard();
    guard.arm("run-1", "u1", [{ action: "delete", id: "chat-1" }, { action: "delete", id: "chat-2" }]);
    const every = Array.from({ length: 200 }, (_, index) => `chat-${index + 1}`);
    const sent = every.filter((id) => refusal(() => guard.authorize("run-1", "u1", id)) === null);
    expect(sent).toEqual(["chat-1", "chat-2"]);
  });

  it("keeps attempt counts when the same run is re-armed, and refuses a changed list", () => {
    const guard = new MutationGuard();
    const commands: Command[] = [{ action: "delete", id: "c1" }];
    guard.arm("run-1", "u1", commands);
    for (let index = 0; index < MAX_ATTEMPTS_PER_CHAT; index += 1) guard.authorize("run-1", "u1", "c1");
    guard.arm("run-1", "u1", commands);
    expect(refusal(() => guard.authorize("run-1", "u1", "c1"))).toContain("attempt limit");
    expect(refusal(() => guard.arm("run-1", "u1", [{ action: "archive", id: "c1" }]))).toContain("different list");
    expect(refusal(() => guard.arm("run-2", "u1", commands))).toContain("Another run");
  });

  it("rejects duplicate and empty command lists", () => {
    const guard = new MutationGuard();
    expect(refusal(() => guard.arm("run-1", "u1", []))).toContain("no changes");
    expect(refusal(() => guard.arm("run-1", "u1", [{ action: "delete", id: "c1" }, { action: "archive", id: "c1" }]))).toContain("twice");
    expect(guard.armedRunId()).toBeNull();
  });

  it("requires typing the count for a large delete batch but not a small one", () => {
    expect(requiresTypedConfirmation(19, 20)).toBe(false);
    expect(requiresTypedConfirmation(20, 20)).toBe(true);
  });
});

function contentBoundary(account = "u1") {
  const clock = createClock();
  const patches: { path: string; body: unknown }[] = [];
  let signedIn = account;
  let sessionGate: (() => Promise<void>) | undefined;
  function holdSession() {
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    sessionGate = () => {
      entered.resolve();
      return released.promise;
    };
    return { entered: entered.promise, release: released.resolve };
  }
  const client = createApiClient({
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/api/auth/session")) {
        const wait = sessionGate;
        sessionGate = undefined;
        await wait?.();
        return jsonResponse(200, { accessToken: "secret-token", user: { id: signedIn } });
      }
      if (path.includes("/backend-api/conversation/") && init?.method !== "PATCH") {
        return jsonResponse(200, { title: "t", is_archived: false, mapping: {} });
      }
      if (init?.method === "PATCH") {
        patches.push({ path, body: JSON.parse(String(init.body)) as unknown });
        return jsonResponse(200, { success: true });
      }
      return jsonResponse(200, {});
    }) as typeof fetch,
    state: createApiState(),
    now: clock.now,
    sleep: clock.sleep,
    config: { ...CONFIG, requestGap: 0 },
  });
  const operator = createOperator(client, () => undefined);
  let next = 0;
  const call = async (body: Record<string, unknown>) => {
    const request = { kind: "chatgpt/api", requestId: String((next += 1)), ...body };
    expect(isApiRequest(request)).toBe(true);
    return operator.handle(request as ApiRequest);
  };
  return { operator, client, patches, call, holdSession, switchAccount: (id: string) => { signedIn = id; } };
}

describe("content-script boundary", () => {
  it("rejects a change that carries its own body", () => {
    expect(isApiRequest({
      kind: "chatgpt/api", requestId: "1", op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1",
      body: { is_visible: false },
    })).toBe(false);
  });

  it("writes the body of the armed command, so an archive can't become a delete", async () => {
    const boundary = contentBoundary();
    boundary.operator.leaseOpened("run-1", "lease-1");
    expect((await boundary.call({ op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "archive", id: "c1" }] })).ok).toBe(true);
    expect((await boundary.call({ op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1" })).ok).toBe(true);
    expect(boundary.patches).toEqual([{ path: "/backend-api/conversation/c1", body: { is_archived: true } }]);
  });

  it("arms only while the dashboard holds the run's lease, and disarms when it closes", async () => {
    const boundary = contentBoundary();
    const arm = { op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "delete", id: "c1" }] };
    expect((await boundary.call(arm)).error?.kind).toBe("auth");
    const revoke = boundary.operator.leaseOpened("run-1", "lease-1");
    expect((await boundary.call(arm)).ok).toBe(true);
    revoke();
    expect(boundary.operator.armedRunId()).toBeNull();
    const change = await boundary.call({ op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1" });
    expect(change.ok).toBe(false);
    expect(boundary.patches).toEqual([]);
  });

  it("refuses to arm a run reviewed for another account", async () => {
    const boundary = contentBoundary("u2");
    boundary.operator.leaseOpened("run-1", "lease-1");
    const armed = await boundary.call({ op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "delete", id: "c1" }] });
    expect(armed.ok).toBe(false);
    expect(armed.error?.message).toContain("account");
  });

  it("disarms and refuses to write once a session refresh shows another account", async () => {
    const boundary = contentBoundary();
    boundary.operator.leaseOpened("run-1", "lease-1");
    await boundary.call({ op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "delete", id: "c1" }] });
    boundary.switchAccount("u2");
    expect((await boundary.call({ op: "session" })).ok).toBe(false);
    expect(boundary.operator.armedRunId()).toBeNull();
    const change = await boundary.call({ op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1" });
    expect(change.ok).toBe(false);
    expect(boundary.patches).toEqual([]);
  });

  it("refuses reads for an account other than the signed-in one", async () => {
    const boundary = contentBoundary("u2");
    const probe = await boundary.call({ op: "probe", accountId: "u1", id: "c1" });
    expect(probe.ok).toBe(false);
    expect(probe.error?.kind).toBe("auth");
    expect((await boundary.call({ op: "probe", accountId: "u2", id: "c1" })).ok).toBe(true);
  });

  it("doesn't arm a run whose lease closed while it was being authorized", async () => {
    const boundary = contentBoundary();
    const revoke = boundary.operator.leaseOpened("run-1", "lease-1");
    const arming = boundary.call({ op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "delete", id: "c1" }] });
    revoke();
    expect((await arming).ok).toBe(false);
    expect(boundary.operator.armedRunId()).toBeNull();
  });

  it("returns the account id without the bearer token", async () => {
    const boundary = contentBoundary();
    const session = await boundary.call({ op: "session" });
    expect(session.value).toEqual({ accountId: "u1" });
    expect(JSON.stringify(session)).not.toContain("secret-token");
  });
});

describe("authorization at dispatch", () => {
  const arm = { op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "archive", id: "c1" }] };
  const change = { op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1" };

  it("rejects an underlying session switch without an explicit session refresh", async () => {
    const boundary = contentBoundary();
    boundary.operator.leaseOpened("run-1", "lease-1");
    expect((await boundary.call(arm)).ok).toBe(true);
    boundary.switchAccount("u2");
    expect((await boundary.call(change)).error?.kind).toBe("auth");
    expect(boundary.patches).toEqual([]);
    expect(boundary.operator.armedRunId()).toBeNull();
  });

  it("does not dispatch if its lease closes while account validation is pending", async () => {
    const boundary = contentBoundary();
    const revoke = boundary.operator.leaseOpened("run-1", "lease-1");
    expect((await boundary.call(arm)).ok).toBe(true);
    const validation = boundary.holdSession();
    const changing = boundary.call(change);
    const entered = await Promise.race([validation.entered.then(() => true), changing.then(() => false)]);
    revoke();
    validation.release();
    expect((await changing).error?.kind).toBe("auth");
    expect(boundary.patches).toEqual([]);
    expect(entered).toBe(true);
  });
});

it("invalidates a pending request when a replacement lease opens before the old disconnect arrives", async () => {
  const boundary = contentBoundary();
  const arm = { op: "arm", runId: "run-1", leaseId: "lease-1", accountId: "u1", commands: [{ action: "archive", id: "c1" }] };
  const change = { op: "change", runId: "run-1", leaseId: "lease-1", accountId: "u1", id: "c1" };
  const revoke = boundary.operator.leaseOpened("run-1", "lease-1");
  expect((await boundary.call(arm)).ok).toBe(true);
  const validation = boundary.holdSession();
  const stale = boundary.call(change);
  await validation.entered;
  boundary.operator.leaseOpened("run-1", "lease-2");
  revoke();
  expect((await boundary.call({ ...arm, leaseId: "lease-2" })).ok).toBe(true);
  validation.release();
  expect((await stale).error?.kind).toBe("auth");
  expect(boundary.patches).toEqual([]);
  expect((await boundary.call(change)).error?.kind).toBe("auth");
  expect((await boundary.call({ ...change, leaseId: "lease-2" })).ok).toBe(true);
  expect(boundary.patches).toHaveLength(1);
});
