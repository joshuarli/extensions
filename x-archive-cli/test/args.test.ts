import { describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "../src/args.ts";
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
      target: "self",
      options: { action: "download", outRoot: "./saved", backend: "bctl", render: false, noContext: true },
    } });
  });

  it("selects the action from flags and rejects contradictory ones", () => {
    expect(parseArgs(["download", "self", "--export-only"])).toMatchObject({ args: { options: { action: "export" } } });
    expect(parseArgs(["download", "self", "--collect-only"])).toMatchObject({ args: { options: { action: "collect" } } });
    expect(() => parseArgs(["download", "self", "--export-only", "--collect-only"])).toThrow("mutually exclusive");
  });

  it("defaults the downloads root", () => {
    expect(parseArgs(["download", "self"])).toMatchObject({ args: { options: { outRoot: downloadsRoot() } } });
  });

  it("rejects missing targets, unknown options, and unknown commands", () => {
    expect(() => parseArgs(["download"])).toThrow("download needs a target");
    expect(() => parseArgs(["download", "self", "--bogus"])).toThrow("Unknown option: --bogus");
    expect(() => parseArgs(["nope"])).toThrow("Unknown command");
  });

  it("exposes the usage text for the entry point", () => {
    expect(USAGE).toContain("x download self");
  });
});
