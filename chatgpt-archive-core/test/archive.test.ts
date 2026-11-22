import { describe, expect, it } from "vitest";
import { createChatgptArchive } from "../src/index.ts";
import type { ChatRef } from "../src/index.ts";
import { ACTIVE_PAGE_0, ARCHIVED_PAGE_0, FakeTransport, makeDeps, page, row } from "./fakes.ts";

describe("session", () => {
  it("reads the session and stores its token for later requests", async () => {
    const transport = new FakeTransport().add("/api/auth/session", {
      user: { id: "acct-1", email: "me@example.com" },
      accessToken: "tok-1",
    });
    const { deps, sleepCalls } = makeDeps(transport, 7);
    const archive = createChatgptArchive(deps);

    expect(await archive.session()).toEqual({ accountId: "acct-1", accessToken: "tok-1" });
    expect(transport.calls).toEqual([{ path: "/api/auth/session" }]);
    expect(sleepCalls).toEqual([7]);

    transport.add(ACTIVE_PAGE_0, page([row("a", 1, 2)], 1));
    await archive.list("active");
    expect(transport.calls[1]?.headers).toEqual({ Authorization: "Bearer tok-1" });
  });

  it("lets setToken replace the token used by list and record", async () => {
    const transport = new FakeTransport()
      .add(ACTIVE_PAGE_0, page([], 0))
      .add("/backend-api/conversation/abc", { mapping: {} });
    const archive = createChatgptArchive(makeDeps(transport).deps);
    archive.setToken("tok-2");

    await archive.list("active");
    await archive.record("abc");
    expect(transport.calls.map((call) => call.headers)).toEqual([
      { Authorization: "Bearer tok-2" },
      { Authorization: "Bearer tok-2" },
    ]);
  });

  it.each([
    { label: "signed out", body: { user: null }, message: /signed out/i },
    { label: "missing user id", body: { user: {} }, message: /signed out/i },
    { label: "missing token", body: { user: { id: "acct" } }, message: /access token/i },
    { label: "non-object body", body: null, message: /signed out/i },
  ])("rejects a $label session", async ({ body, message }) => {
    const transport = new FakeTransport().add("/api/auth/session", body);
    const archive = createChatgptArchive(makeDeps(transport).deps);
    await expect(archive.session()).rejects.toThrow(message);
  });

  it("rejects list and record before a token is available without issuing requests", async () => {
    const transport = new FakeTransport();
    const archive = createChatgptArchive(makeDeps(transport).deps);
    await expect(archive.list("active")).rejects.toThrow(/access token/i);
    await expect(archive.record("abc")).rejects.toThrow(/access token/i);
    expect(transport.calls).toHaveLength(0);
  });
});

describe("list", () => {
  it("pages both scopes, normalizes rows, calls back per page, and paces each request", async () => {
    const second = "/backend-api/conversations?offset=2&limit=100&order=updated";
    const transport = new FakeTransport()
      .add(ACTIVE_PAGE_0, page([
        row("a", 1000, 2000),
        row("b", 3000, 4000),
      ], 4))
      .add(second, page([
        row("c", 5000, 6000),
        row("d", 7000, 8000, true),
      ], 4))
      .add(ARCHIVED_PAGE_0, page([row("e", 1, 2, true)], 1));
    const { deps, sleepCalls } = makeDeps(transport, 7);
    const archive = createChatgptArchive(deps);
    archive.setToken("tok");

    const seen: ChatRef[][] = [];
    const active = await archive.list("active", (chats) => {
      seen.push(chats);
    });
    expect(transport.calls.map((call) => call.path)).toEqual([ACTIVE_PAGE_0, second]);
    expect(seen.map((chunk) => chunk.map((chat) => chat.id))).toEqual([["a", "b"], ["c", "d"]]);
    expect(active[0]).toEqual({
      id: "a", title: "Chat a", createdMs: 1_000_000, updatedMs: 2_000_000, archived: false,
    });
    expect(active[3]?.archived).toBe(true);
    expect(sleepCalls).toEqual([7, 7]);

    const archived = await archive.list("archived");
    expect(transport.calls[2]?.path).toBe(ARCHIVED_PAGE_0);
    expect(archived).toEqual([{
      id: "e", title: "Chat e", createdMs: 1000, updatedMs: 2000, archived: true,
    }]);
    expect(sleepCalls).toEqual([7, 7, 7]);
  });

  it("rejects a malformed row instead of dropping it", async () => {
    const transport = new FakeTransport().add(ACTIVE_PAGE_0, page([
      { id: "a", title: "Chat a", update_time: 1, is_archived: false },
    ], 1));
    const archive = createChatgptArchive(makeDeps(transport).deps);
    archive.setToken("tok");
    await expect(archive.list("active")).rejects.toThrow(/malformed conversation row/i);
  });

  it("uses the default request gap when none is configured", async () => {
    const transport = new FakeTransport().add(ACTIVE_PAGE_0, page([], 0));
    const { deps, sleepCalls } = makeDeps(transport);
    const archive = createChatgptArchive(deps);
    archive.setToken("tok");
    await archive.list("active");
    expect(sleepCalls).toEqual([1200]);
  });
});
