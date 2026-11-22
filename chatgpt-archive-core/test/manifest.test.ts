import { describe, expect, it } from "vitest";
import { createChatgptArchive } from "../src/index.ts";
import type { ArchiveManifest, ChatRef } from "../src/index.ts";
import { FakeTransport, makeDeps } from "./fakes.ts";

const input: Omit<ArchiveManifest, "format" | "version"> = {
  accountId: "acct-1",
  createdAt: "2026-01-02T03:04:05.000Z",
  since: null,
  until: "2026-02-01T00:00:00.000Z",
  timeField: "updated",
  total: 12,
  archived: 3,
  sha256OfRecords: "abcdef",
};

describe("manifest", () => {
  it("emits deterministic pretty JSON with a trailing newline", () => {
    const api = createChatgptArchive(makeDeps(new FakeTransport()).deps);
    const expected = JSON.stringify({
      format: "chatgpt-archive",
      version: 1,
      accountId: "acct-1",
      createdAt: "2026-01-02T03:04:05.000Z",
      since: null,
      until: "2026-02-01T00:00:00.000Z",
      timeField: "updated",
      total: 12,
      archived: 3,
      sha256OfRecords: "abcdef",
    }, null, 2) + "\n";

    expect(api.buildManifest(input)).toBe(expected);
    expect(api.buildManifest(input)).toBe(api.buildManifest(input));
  });

  it("falls back to the injected clock for an empty createdAt", () => {
    const api = createChatgptArchive(makeDeps(new FakeTransport(), undefined, 1_700_000_000_000).deps);
    const manifest = JSON.parse(api.buildManifest({ ...input, createdAt: "" })) as ArchiveManifest;
    expect(manifest.createdAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("treats both timeframe bounds as inclusive on the chosen field", () => {
    const api = createChatgptArchive(makeDeps(new FakeTransport()).deps);
    const chat: ChatRef = {
      id: "c", title: "t", createdMs: 100, updatedMs: 200, archived: false,
    };

    expect(api.withinTimeframe(chat, 100, 200, "created")).toBe(true);
    expect(api.withinTimeframe(chat, 100, 100, "created")).toBe(true);
    expect(api.withinTimeframe(chat, 101, null, "created")).toBe(false);
    expect(api.withinTimeframe(chat, null, 99, "updated")).toBe(false);
    expect(api.withinTimeframe(chat, 200, 200, "updated")).toBe(true);
    expect(api.withinTimeframe(chat, null, null, "updated")).toBe(true);
    expect(api.withinTimeframe(chat, 500, 600, "updated")).toBe(false);
  });
});
