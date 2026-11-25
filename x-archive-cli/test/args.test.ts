import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_MEDIA_BYTES, parseArgs, parseMaxMediaSize, USAGE } from "../src/args.ts";
import { downloadsRoot } from "../src/state.ts";

describe("x arguments", () => {
  it("returns help and version commands", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["download", "-h"])).toEqual({ kind: "help" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("accepts both option forms and flags", () => {
    const split = parseArgs(["download", "self", "--out", "./saved", "--backend", "bctl", "--no-render", "--no-context"]);
    const joined = parseArgs(["download", "self", "--out=./saved", "--backend=bctl", "--no-render", "--no-context"]);
    expect(split).toEqual(joined);
    expect(split).toMatchObject({ kind: "download", args: {
      targets: ["self"],
      options: { action: "download", outRoot: "./saved", backend: "bctl", render: false, noContext: true },
    } });
  });

  it("accepts multiple targets in order", () => {
    expect(parseArgs(["download", "inve1ns", "cleanjpg", "@third"])).toMatchObject({
      kind: "download",
      args: { targets: ["inve1ns", "cleanjpg", "@third"] },
    });
  });

  it("accepts self mixed with profiles and options between targets", () => {
    const parsed = parseArgs(["download", "self", "--out", "./saved", "inve1ns", "cleanjpg", "--no-render"]);
    expect(parsed).toMatchObject({
      kind: "download",
      args: {
        targets: ["self", "inve1ns", "cleanjpg"],
        options: { outRoot: "./saved", render: false },
      },
    });
  });

  it("selects the action from flags and rejects contradictory ones", () => {
    expect(parseArgs(["download", "self", "--export-only"])).toMatchObject({ args: { options: { action: "export" } } });
    expect(parseArgs(["download", "self", "--collect-only"])).toMatchObject({ args: { options: { action: "collect" } } });
    expect(() => parseArgs(["download", "self", "--export-only", "--collect-only"])).toThrow("mutually exclusive");
  });

  it("defaults the downloads root and the media size limit", () => {
    expect(parseArgs(["download", "self"])).toMatchObject({ args: { options: {
      outRoot: downloadsRoot(),
      maxMediaBytes: 16 * 1024 * 1024,
    } } });
    expect(DEFAULT_MAX_MEDIA_BYTES).toBe(16 * 1024 * 1024);
  });

  it("parses media size units and zero", () => {
    expect(parseMaxMediaSize("16MB")).toBe(16 * 1024 * 1024);
    expect(parseMaxMediaSize("500kb")).toBe(500 * 1024);
    expect(parseMaxMediaSize("2g")).toBe(2 * 1024 * 1024 * 1024);
    expect(parseMaxMediaSize("4096")).toBe(4096);
    expect(parseMaxMediaSize("0")).toBe(0);
    expect(() => parseMaxMediaSize("-1")).toThrow("--max-media-size");
    expect(() => parseMaxMediaSize("1.5MB")).toThrow("--max-media-size");
    expect(() => parseMaxMediaSize("16TB")).toThrow("--max-media-size");
    expect(parseArgs(["download", "self", "--max-media-size=1MB"])).toMatchObject({
      args: { options: { maxMediaBytes: 1024 * 1024 } },
    });
  });

  it("rejects missing targets, unknown options, and unknown commands", () => {
    expect(() => parseArgs(["download"])).toThrow("download needs at least one target");
    expect(() => parseArgs(["download", "self", "--bogus"])).toThrow("Unknown option: --bogus");
    expect(() => parseArgs(["nope"])).toThrow("Unknown command");
  });

  it("exposes the usage text for the entry point", () => {
    expect(USAGE).toContain("x download self");
  });
});
