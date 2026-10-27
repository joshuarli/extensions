import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPolyglot } from "../src/polyglot.ts";

const onePixelPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x0f, 0x00, 0x01, 0xf6, 0x75, 0x53, 0xbe, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("archive integrity with the system unzip binary", () => {
  it("passes unzip -t on a generated polyglot", () => {
    const archive = buildPolyglot({
      pageHtml:
        '<!DOCTYPE html><html><head><title>t</title></head><body><img src="onefile-resource-0"></body></html>',
      loaderSource: "/*loader*/",
      resources: [{ name: "resources/0.png", mime: "image/png", data: onePixelPng }],
      sourceUrl: "https://example.com/",
      capturedAtMs: 1_700_000_000_000,
      unresolved: [],
    });
    const scratch = join(tmpdir(), `onefile-unzip-${process.pid}`);
    mkdirSync(scratch, { recursive: true });
    try {
      const filePath = join(scratch, "probe.u.zip.html");
      writeFileSync(filePath, archive.fileBytes);
      let output: string;
      try {
        output = execFileSync("unzip", ["-t", filePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          console.warn("unzip binary is missing, skipping interop check");
          return;
        }
        throw error;
      }
      expect(output).toContain("No errors detected");
      expect(output).toContain("resources/0.png");
      expect(output).toContain("metadata.json");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
