import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../src/args.ts";

describe("parseArgs", () => {
  it("defaults collect to Helium, home-for-you, 20 pages and the data directory", () => {
    const command = parseArgs(["collect"]);
    expect(command.kind).toBe("collect");
    if (command.kind !== "collect") throw new Error("expected collect");
    expect(command.args.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(command.args.feed).toBe("home-for-you");
    expect(command.args.maxPages).toBe(20);
    expect(command.args.outDir.endsWith("/x/discovery/movies")).toBe(true);
  });

  it("accepts explicit options and the link check flag", () => {
    const command = parseArgs(["derive", "--out", "/tmp/discovery", "--check-links"]);
    expect(command.kind).toBe("derive");
    if (command.kind !== "derive") throw new Error("expected derive");
    expect(command.args.outDir).toBe("/tmp/discovery");
    expect(command.args.checkLinks).toBe(true);
  });

  it("rejects unknown commands, feeds and page limits", () => {
    expect(() => parseArgs(["nope"])).toThrow(UsageError);
    expect(() => parseArgs(["collect", "--feed=search"])).toThrow("--feed");
    expect(() => parseArgs(["collect", "--max-pages=0"])).toThrow("positive integer");
  });

  it("serves help and version without a browser", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });
});
