import { describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";

describe("tools dispatcher", () => {
  it("lists commands on help", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["--help"])).toBe(0);
      const text = output.mock.calls.map((call) => String(call[0])).join("");
      expect(text).toContain("tools <command>");
      expect(text).toContain("youtube");
      expect(text).toContain("chatgpt");
      expect(text).toContain("archive a Hacker News discussion");
    } finally {
      output.mockRestore();
    }
  });

  it("rejects unknown commands", async () => {
    const output = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await main(["nope"])).toBe(2);
      expect(output.mock.calls.map((call) => String(call[0])).join("")).toContain('unknown command "nope"');
    } finally {
      output.mockRestore();
    }
  });
});
