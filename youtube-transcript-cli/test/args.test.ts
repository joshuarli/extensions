import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../src/args.ts";

describe("parseArgs", () => {
  it("shows help and version", () => {
    expect(parseArgs([]).kind).toBe("help");
    expect(parseArgs(["--version"]).kind).toBe("version");
  });

  it("parses a YouTube URL with options", () => {
    const command = parseArgs(["https://youtu.be/UH6HCSNs7Os", "--language=fr", "--format=srt", "--out=/tmp/t.srt"]);
    expect(command.kind).toBe("transcript");
    if (command.kind !== "transcript") return;
    expect(command.options).toEqual({
      url: "https://youtu.be/UH6HCSNs7Os",
      language: "fr",
      format: "srt",
      out: "/tmp/t.srt",
    });
  });

  it("rejects non-YouTube URLs and unknown formats", () => {
    expect(() => parseArgs(["https://example.com/watch?v=abc"])).toThrow(UsageError);
    expect(() => parseArgs(["https://youtu.be/abc", "--format=txt"])).toThrow("Unknown format");
  });
});
