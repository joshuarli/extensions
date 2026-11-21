import { describe, expect, it } from "vitest";
import { decodeApiResponse, isApiRequest, isPingRequest } from "../src/messages.ts";

describe("typed message boundary", () => {
  it("accepts each API operation", () => {
    const requests = [
      { kind: "chatgpt/api", requestId: "1", op: "session" },
      { kind: "chatgpt/api", requestId: "2", op: "list", scope: "active" },
      { kind: "chatgpt/api", requestId: "3", op: "projects" },
      { kind: "chatgpt/api", requestId: "4", op: "conversation", id: "c1" },
      { kind: "chatgpt/api", requestId: "5", op: "record", id: "c1" },
      { kind: "chatgpt/api", requestId: "5b", op: "probe", id: "c1" },
      { kind: "chatgpt/api", requestId: "6", op: "change", runId: "run-1", accountId: "u1", id: "c1" },
      {
        kind: "chatgpt/api", requestId: "7", op: "arm", runId: "run-1", accountId: "u1",
        commands: [{ action: "delete", id: "c1" }, { action: "rename", id: "c2", title: "T" }, { action: "move", id: "c3", project: "" }],
      },
      { kind: "chatgpt/api", requestId: "8", op: "disarm", runId: "run-1" },
    ];
    for (const request of requests) expect(isApiRequest(request)).toBe(true);
  });

  it("rejects unknown operations, missing fields and excess properties", () => {
    expect(isApiRequest({ kind: "chatgpt/api", requestId: "1", op: "delete-all" })).toBe(false);
    expect(isApiRequest({ kind: "chatgpt/api", op: "session" })).toBe(false);
    expect(isApiRequest({ kind: "chatgpt/api", requestId: "1", op: "session", id: "extra" })).toBe(false);
    expect(isApiRequest({ kind: "chatgpt/api", requestId: "1", op: "change", id: "c1", body: { is_visible: false } })).toBe(false);
    expect(isApiRequest({
      kind: "chatgpt/api", requestId: "1", op: "arm", runId: "r", accountId: "u1",
      commands: [{ action: "archive", id: "c1", title: "smuggled" }],
    })).toBe(false);
    expect(isApiRequest({
      kind: "chatgpt/api", requestId: "1", op: "arm", runId: "r", accountId: "u1",
      commands: [{ action: "archive", id: "c1", body: { is_visible: false } }],
    })).toBe(false);
    expect(isApiRequest({ kind: "other", requestId: "1", op: "session" })).toBe(false);
  });

  it("decodes success and failure responses", () => {
    const ok = decodeApiResponse({
      kind: "chatgpt/api:response", requestId: "1", ok: true, value: { items: [] }, error: null,
    });
    expect(ok?.ok).toBe(true);
    const failed = decodeApiResponse({
      kind: "chatgpt/api:response", requestId: "2", ok: false, value: null,
      error: { kind: "ratelimit", message: "slow down", until: 123 },
    });
    expect(failed?.error).toEqual({ kind: "ratelimit", message: "slow down", until: 123 });
    expect(decodeApiResponse({ kind: "nope" })).toBeNull();
  });

  it("recognises the ping request", () => {
    expect(isPingRequest("chatgpt/ping")).toBe(true);
    expect(isPingRequest("chatgpt/api")).toBe(false);
  });
});
