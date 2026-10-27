import { describe, expect, it } from "vitest";
import { crc32 } from "../src/crc32.ts";
import { assertZipLimits, buildStoredZip, extractStoredEntry, readStoredArchive } from "../src/zip.ts";

const textEncoder = new TextEncoder();

describe("crc32", () => {
  it("matches the standard check vector", () => {
    expect(crc32(textEncoder.encode("123456789"))).toBe(0xcb_f4_39_26);
  });

  it("is empty-stable", () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00_00_00_00);
  });
});

describe("stored zip", () => {
  it("round-trips entries with file-absolute offsets", () => {
    const prefix = textEncoder.encode("<!DOCTYPE html><p>prefix</p>"),
      files = [
        { name: "resources/0.png", data: new Uint8Array([1, 2, 3, 4]), modifiedMs: 1_700_000_000_000 },
        { name: "metadata.json", data: textEncoder.encode('{"a":1}'), modifiedMs: 1_700_000_000_000 },
      ],
      zipBytes = buildStoredZip({ files, archiveStartOffset: prefix.length }),
      fileBytes = new Uint8Array(prefix.length + zipBytes.length);
    fileBytes.set(prefix, 0);
    fileBytes.set(zipBytes, prefix.length);
    const directory = readStoredArchive(fileBytes);
    expect(directory.entries.map((entry) => entry.name)).toEqual(["resources/0.png", "metadata.json"]);
    expect(extractStoredEntry(directory, "resources/0.png")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(extractStoredEntry(directory, "metadata.json")).toEqual(textEncoder.encode('{"a":1}'));
  });

  it("keeps unicode names intact", () => {
    const name = "resources/0-üñí.png",
      zipBytes = buildStoredZip({
        files: [{ name, data: new Uint8Array([9]), modifiedMs: 0 }],
        archiveStartOffset: 0,
      }),
      directory = readStoredArchive(zipBytes);
    expect(directory.entries[0]?.name).toBe(name);
    expect(extractStoredEntry(directory, name)).toEqual(new Uint8Array([9]));
  });

  it("survives zip delimiter byte sequences inside content", () => {
    const data = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x50, 0x4b, 0x01, 0x02, 0x50, 0x4b, 0x05, 0x06]),
      zipBytes = buildStoredZip({
        files: [{ name: "resources/0.bin", data, modifiedMs: 0 }],
        archiveStartOffset: 7,
      }),
      fileBytes = new Uint8Array(7 + zipBytes.length);
    fileBytes.set(zipBytes, 7);
    const directory = readStoredArchive(fileBytes);
    expect(extractStoredEntry(directory, "resources/0.bin")).toEqual(data);
  });

  it("refuses tampered content", () => {
    const zipBytes = buildStoredZip({
      files: [{ name: "a.txt", data: textEncoder.encode("hello"), modifiedMs: 0 }],
      archiveStartOffset: 0,
    });
    zipBytes[40] = zipBytes[40] === 0 ? 1 : 0;
    expect(() => readStoredArchive(zipBytes)).toThrow();
  });

  it("holds the 32-bit entry budget and refuses the 65536th entry", () => {
    const files = Array.from({ length: 65_535 }, (_, index) => ({ name: `f/${index}`, size: 1 })),
      writable = Array.from({ length: 65_536 }, (_, index) => ({ name: `f/${index}`, data: new Uint8Array([1]), modifiedMs: 0 }));
    expect(() => assertZipLimits(files, 0)).not.toThrow();
    expect(() => assertZipLimits([...files, { name: "f/overflow", size: 1 }], 0)).toThrow(/at most/);
    expect(() => buildStoredZip({ files: writable, archiveStartOffset: 0 })).toThrow(/at most/);
  });

  it("refuses entries and offsets outside the 32-bit range without allocating", () => {
    expect(() => assertZipLimits([{ name: "big.bin", size: 0xff_ff_ff_ff + 1 }], 0)).toThrow(/size range/);
    expect(() => assertZipLimits([{ name: "a", size: 10 }], 0xff_ff_ff_ff + 1)).toThrow(/start offset/);
    expect(() => assertZipLimits([{ name: "a", size: 0xff_ff_ff_ff }], 100)).toThrow(/offset range/);
    expect(() => assertZipLimits([{ name: "ok", size: 0xff_ff_ff_ff - 200 }], 0)).not.toThrow();
  });

  it("refuses unknown entries and non-stored methods", () => {
    const zipBytes = buildStoredZip({
      files: [{ name: "a.txt", data: textEncoder.encode("hi"), modifiedMs: 0 }],
      archiveStartOffset: 0,
    }),
      directory = readStoredArchive(zipBytes);
    expect(() => extractStoredEntry(directory, "missing.txt")).toThrow();
    const centralStart = 30 + "a.txt".length + "hi".length,
      view = new DataView(zipBytes.buffer);
    view.setUint16(centralStart + 10, 8, true);
    const tampered = readStoredArchive(zipBytes);
    expect(() => extractStoredEntry(tampered, "a.txt")).toThrow(/method/);
  });
});
