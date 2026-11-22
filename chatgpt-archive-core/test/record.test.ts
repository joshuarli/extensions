import { describe, expect, it } from "vitest";
import { createChatgptArchive } from "../src/index.ts";
import type { ChatRef } from "../src/index.ts";
import { FakeTransport, makeDeps } from "./fakes.ts";

const chat: ChatRef = {
  id: "c-1",
  title: "A chat",
  createdMs: 1_000,
  updatedMs: 2_000,
  archived: false,
};

function archive() {
  return createChatgptArchive(makeDeps(new FakeTransport()).deps);
}

describe("archived records", () => {
  it("hashes canonical JSON deterministically and keeps the record verbatim", async () => {
    const api = archive();
    const original = { zebra: 1, inner: { yankee: 2, alpha: [3, 4] } };
    const reordered = { inner: { alpha: [3, 4], yankee: 2 }, zebra: 1 };

    const first = await api.toArchivedRecord(chat, original);
    const second = await api.toArchivedRecord(chat, reordered);
    const changed = await api.toArchivedRecord(chat, { ...reordered, extra: true });

    expect(first.recordSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.recordSha256).toBe(second.recordSha256);
    expect(first.recordSha256).not.toBe(changed.recordSha256);
    expect(first.record).toBe(original);
    expect(first).toMatchObject({
      id: "c-1",
      title: "A chat",
      createdMs: 1_000,
      updatedMs: 2_000,
      url: "https://chatgpt.com/c/c-1",
    });
  });

  it("round-trips an encoded line through the schema", async () => {
    const api = archive();
    const record = await api.toArchivedRecord(chat, { mapping: { a: { message: "hi" } } });
    const line = api.encodeRecordLine(record);

    expect(line).not.toContain("\n");
    expect(api.decodeRecordLine(line)).toEqual(record);
  });

  it("returns null for malformed, unknown-version, and incomplete lines", async () => {
    const api = archive();
    const line = api.encodeRecordLine(await api.toArchivedRecord(chat, { mapping: {} }));
    const unknownVersion = { ...JSON.parse(line) as Record<string, unknown>, version: 2 };
    const missingField = JSON.parse(line) as Record<string, unknown>;
    delete missingField["recordSha256"];

    expect(api.decodeRecordLine("not json")).toBeNull();
    expect(api.decodeRecordLine("[]")).toBeNull();
    expect(api.decodeRecordLine(JSON.stringify(unknownVersion))).toBeNull();
    expect(api.decodeRecordLine(JSON.stringify(missingField))).toBeNull();
  });
});
