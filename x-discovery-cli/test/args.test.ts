import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../src/args.ts";

describe("parseArgs", () => {
  it("defaults to Helium CDP, 20 pages and the X discovery data directory", () => {
    const command = parseArgs([]);
    expect(command.kind).toBe("run");
    if (command.kind !== "run") throw new Error("expected a run command");
    expect(command.cdpUrl).toBe("http://127.0.0.1:9222");
    expect(command.maxPages).toBe(20);
    expect(command.outDir.endsWith("/x/discovery")).toBe(true);
  });

  it("accepts explicit connection, page and output options", () => {
    expect(parseArgs(["--cdp-url", "http://127.0.0.1:9333", "--max-pages=5", "--out", "/tmp/discovery"]))
      .toEqual({ kind: "run", cdpUrl: "http://127.0.0.1:9333", maxPages: 5, outDir: "/tmp/discovery" });
  });

  it("rejects a non-positive page limit", () => {
    expect(() => parseArgs(["--max-pages", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["--max-pages", "many"])).toThrow("positive integer");
  });

  it("serves help and version without a browser", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });
});
