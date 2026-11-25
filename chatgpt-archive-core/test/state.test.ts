import { describe, expect, it } from "vitest";
import { decodeArchiveState, emptyArchiveState, encodeArchiveState } from "../src/index.ts";

describe("archive state", () => {
  it("round-trips an empty checkpoint for an account", () => {
    const state = emptyArchiveState("acct-1");
    expect(decodeArchiveState(encodeArchiveState(state))).toEqual(state);
  });

  it("round-trips completed scopes and scan counts", () => {
    const state = {
      ...emptyArchiveState("acct-1"),
      scopes: {
        active: { complete: true, scanned: 12 },
        archived: { complete: false, scanned: 3 },
      },
    };
    expect(decodeArchiveState(encodeArchiveState(state))).toEqual(state);
  });

  it("rejects unreadable, foreign-format and invalid-count state", () => {
    expect(decodeArchiveState("not json")).toBeNull();
    expect(decodeArchiveState(JSON.stringify({ ...emptyArchiveState("acct"), format: "other" }))).toBeNull();
    expect(decodeArchiveState(JSON.stringify({
      ...emptyArchiveState("acct"),
      scopes: {
        active: { complete: true, scanned: -1 },
        archived: { complete: false, scanned: 0 },
      },
    }))).toBeNull();
  });
});
