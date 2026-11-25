import { describe, expect, it, vi } from "vitest";
import { extractStoredEntry, readStoredArchive } from "../../onefile-core/src/zip.ts";
import { help, outputDirectory, parseArgs } from "../src/args.ts";
import { main } from "../src/main.ts";
import { assembleCapture } from "../src/save.ts";

describe("onefile arguments", () => {
  it("parses both option forms and the documented example", () => {
    expect(parseArgs(["save", "https://example.com/", "--out", "./saved"], {}).kind).toBe("save");
    expect(parseArgs(["save", "https://example.com/", "--backend=bctl", "--session", "work"], {})).toMatchObject({ options: { backend: "bctl", session: "work" } });
    expect(help).toContain("pnpm onefile save https://example.com/ --out ./saved");
    expect(parseArgs(["save", "-h"])).toEqual({ kind: "help" });
    expect(parseArgs([])).toEqual({ kind: "help" });
  });
  it("rejects invalid input", () => {
    for (const args of [["save"], ["save", "file:///a"], ["save", "https://example.com", "--out"], ["save", "https://example.com", "--bad"], ["save", "https://example.com", "--out=a", "--out=b"]]) expect(() => parseArgs(args, {})).toThrow();
  });
  it("chooses output directory by precedence", () => {
    expect(outputDirectory(undefined, { XDG_DATA_HOME: "/data" })).toBe("/data/onefile");
    expect(outputDirectory(undefined, { XDG_DATA_HOME: "/data", ONEFILE_OUT: "/direct" })).toBe("/direct");
    expect(outputDirectory("/explicit", { ONEFILE_OUT: "/direct" })).toBe("/explicit");
  });
});

describe("onefile interrupt", () => {
  it("removes its SIGINT listener when main returns", async () => {
    const before = process.listenerCount("SIGINT");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["--version"])).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("archive assembly", () => {
  it("writes resources and records failures in the embedded zip", async () => {
    const result = await assembleCapture({ pageUrl: "https://example.com/", title: "Example", capturedAtMs: 1700000000000, pageHtml: '<html><head></head><body><img src="onefile-resource-0"><img src="onefile-resource-1"></body></html>', resources: [{ url: "https://example.com/a.png", kind: "image" }, { url: "https://example.com/missing.png", kind: "image" }], unresolved: [] }, "globalThis.loader=true;", async (url) => { if (url.includes("missing")) throw new Error("unavailable"); return { data: new Uint8Array([1, 2, 3]), mime: "image/png" }; });
    const zip = readStoredArchive(result.bytes);
    expect(extractStoredEntry(zip, "resources/0.png")).toEqual(new Uint8Array([1, 2, 3]));
    const metadata = JSON.parse(new TextDecoder().decode(extractStoredEntry(zip, "metadata.json"))) as { unresolved: { url: string; reason: string }[] };
    expect(metadata.unresolved).toEqual([{ url: "https://example.com/missing.png", reason: "unavailable" }]);
    expect(result.missingCount).toBe(1);
    expect(new TextDecoder().decode(result.bytes)).toContain("onefile-missing");
  });
});
