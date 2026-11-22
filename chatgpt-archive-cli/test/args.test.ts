import { describe, expect, it } from "vitest";
import { parseArgs, USAGE, UsageError } from "../src/args.ts";
import { downloadsRoot } from "../src/state.ts";

describe("chatgpt-archive arguments", () => {
  it("returns help and version commands", () => {
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["download", "-h"])).toEqual({ kind: "help" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("parses values, flags and the default downloads root", () => {
    const parsed = parseArgs([
      "download",
      "--since", "2024-01-01T00:00:00Z",
      "--until", "2024-06-01T00:00:00Z",
      "--time-field", "created",
      "--out", "./saved",
      "--include-archived",
      "--no-media",
      "--limit", "3",
      "--backend", "bctl",
      "--session", "research",
      "--cdp-url", "http://127.0.0.1:9333",
    ]);
    expect(parsed).toEqual({ kind: "download", options: {
      since: "2024-01-01T00:00:00Z",
      until: "2024-06-01T00:00:00Z",
      sinceMs: Date.parse("2024-01-01T00:00:00Z"),
      untilMs: Date.parse("2024-06-01T00:00:00Z"),
      timeField: "created",
      outRoot: "./saved",
      includeArchived: true,
      noMedia: true,
      limit: 3,
      backend: "bctl",
      session: "research",
      cdpUrl: "http://127.0.0.1:9333",
    } });
    expect(parseArgs(["download"])).toEqual({ kind: "download", options: {
      since: null,
      until: null,
      sinceMs: null,
      untilMs: null,
      timeField: "updated",
      outRoot: downloadsRoot(),
      includeArchived: false,
      noMedia: false,
      limit: null,
      backend: undefined,
      session: undefined,
      cdpUrl: undefined,
    } });
  });

  it("accepts joined option forms", () => {
    const split = parseArgs(["download", "--time-field=updated", "--limit=2", "--out=/tmp/archive"]);
    const separate = parseArgs(["download", "--time-field", "updated", "--limit", "2", "--out", "/tmp/archive"]);
    expect(split).toEqual(separate);
  });

  it("rejects invalid commands, flags, values and limits with UsageError", () => {
    expect(() => parseArgs(["nope"])).toThrow(UsageError);
    expect(() => parseArgs(["nope"])).toThrow("Unknown command");
    expect(() => parseArgs(["download", "--bogus"])).toThrow("Unknown option: --bogus");
    expect(() => parseArgs(["download", "--out"])).toThrow("Missing value for --out");
    expect(() => parseArgs(["download", "extra"])).toThrow("Unexpected argument");
    expect(() => parseArgs(["download", "--time-field", "other"])).toThrow("created or updated");
    expect(() => parseArgs(["download", "--since", "yesterday"])).toThrow("ISO-8601");
    expect(() => parseArgs(["download", "--limit", "0"])).toThrow("positive integer");
    expect(() => parseArgs(["download", "--limit", "-2"])).toThrow("Missing value for --limit");
    expect(() => parseArgs(["download", "--limit", "1.5"])).toThrow("positive integer");
    expect(() => parseArgs(["download", "--include-archived", "--include-archived"])).toThrow("Repeated option");
  });

  it("documents the attach, timeframe, resume and media contract", () => {
    expect(USAGE).toContain("127.0.0.1:9222");
    expect(USAGE).toContain("--include-archived");
    expect(USAGE).toContain("ISO-8601");
    expect(USAGE).toContain("append-only");
    expect(USAGE).toContain("resumes");
    expect(USAGE).toContain("--no-media");
    expect(USAGE).toContain("best-effort");
  });
});
