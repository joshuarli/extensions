import { describe, expect, it } from "vitest";
import { buildArchiveFilename, resourceEntryName, sanitizeTitleForFilename } from "../src/filename.ts";

describe("sanitizeTitleForFilename", () => {
  it("matches the chartered example shape", () => {
    expect(buildArchiveFilename("Page Title", new Date(2026, 9, 27, 15, 30, 0))).toBe(
      "Page Title (2026-10-27 15-30-00).u.zip.html",
    );
  });

  it("strips filesystem-hostile characters and collapses space", () => {
    expect(sanitizeTitleForFilename('a<b>c:d"e/f\\g|h?i*j   k')).toBe("abcdefghij k");
  });

  it("falls back for empty titles and trims trailing dots", () => {
    expect(sanitizeTitleForFilename("   ")).toBe("Untitled page");
    expect(sanitizeTitleForFilename("notes...")).toBe("notes");
  });
});

describe("resourceEntryName", () => {
  it("prefers the mime map over the url", () => {
    expect(resourceEntryName(0, "https://x/y.jpeg", "image/png")).toBe("resources/0.png");
    expect(resourceEntryName(3, "https://x/y", "font/woff2")).toBe("resources/3.woff2");
  });

  it("falls back to the url extension, then bin", () => {
    expect(resourceEntryName(1, "https://x/y.custom", "application/octet-stream")).toBe("resources/1.custom");
    expect(resourceEntryName(2, "https://x/y", "application/octet-stream")).toBe("resources/2.bin");
  });
});
