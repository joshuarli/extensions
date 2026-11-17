import { describe, expect, it } from "vitest";
import { buildArchiveFilename, originPathName, resourceEntryName } from "../src/filename.ts";

describe("originPathName", () => {
  it("keeps nested paths and strips leading slashes", () => {
    expect(originPathName("https://example.com/vendor/garden-art.js")).toBe("vendor/garden-art.js");
    expect(originPathName("https://example.com/startup.js")).toBe("startup.js");
  });

  it("decodes percent-encoded segments so archive paths match decoded requests", () => {
    expect(originPathName("https://example.com/my%20module.js")).toBe("my module.js");
    expect(originPathName("https://example.com/100%25.js")).toBe("100%.js");
  });

  it("rejects the root", () => {
    expect(originPathName("https://example.com/")).toBeNull();
  });

  it("resolves percent-encoded dot segments at the URL layer", () => {
    expect(originPathName("https://example.com/%2e%2e/evil.js")).toBe("evil.js");
    expect(originPathName("https://example.com/a/../evil.js")).toBe("evil.js");
  });

  it("rejects traversal that survives decoding encoded slashes", () => {
    expect(originPathName("https://example.com/a/%2e%2e%2f..%2fb.js")).toBeNull();
  });
});

describe("resourceEntryName", () => {
  it("names images by served MIME type", () => {
    expect(resourceEntryName(3, "https://example.com/x", "image/png")).toBe("resources/3.png");
  });
});

describe("buildArchiveFilename", () => {
  it("keeps the title and timestamp", () => {
    expect(buildArchiveFilename("Hello World", new Date(2024, 4, 1, 10, 20, 30))).toBe(
      "Hello World (2024-05-01 10-20-30).u.zip.html",
    );
  });
});
