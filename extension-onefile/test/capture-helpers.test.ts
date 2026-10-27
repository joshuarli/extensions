import { describe, expect, it } from "vitest";
import {
  absolutizeHttpUrl,
  collectCssResources,
  splitSrcset,
} from "../src/inject/capture.ts";

describe("absolutizeHttpUrl", () => {
  it("resolves relative urls and rejects non-http schemes", () => {
    expect(absolutizeHttpUrl("a/b.png", "https://example.com/p/")).toBe("https://example.com/p/a/b.png");
    expect(absolutizeHttpUrl("data:image/png;base64,AA==", "https://example.com/")).toBeNull();
    expect(absolutizeHttpUrl("blob:https://example.com/x", "https://example.com/")).toBeNull();
    expect(absolutizeHttpUrl("https://", "https://example.com/")).toBeNull();
  });
});

describe("splitSrcset", () => {
  it("splits candidates with descriptors", () => {
    expect(splitSrcset("a.png 1x, b.png 2x")).toEqual([
      { url: "a.png", descriptor: "1x" },
      { url: "b.png", descriptor: "2x" },
    ]);
    expect(splitSrcset("  ")).toEqual([]);
  });
});

describe("collectCssResources", () => {
  it("absolutizes url() refs and keeps data uris untouched", () => {
    const { rewritten, resources } = collectCssResources(
      ".a{background:url(img/a.png)} .b{background:url(\"data:image/png;base64,AA==\")}",
      "https://example.com/css/",
    );
    expect(rewritten).toContain('url("https://example.com/css/img/a.png")');
    expect(rewritten).toContain('url("data:image/png;base64,AA==")');
    expect(resources).toEqual([{ url: "https://example.com/css/img/a.png", kind: "image" }]);
  });

  it("classifies @font-face urls as fonts", () => {
    const { resources } = collectCssResources(
      "@font-face{font-family:x;src:url(fonts/a.woff2)} .a{background:url(img/b.png)}",
      "https://example.com/",
    );
    expect(resources).toContainEqual({ url: "https://example.com/fonts/a.woff2", kind: "font" });
    expect(resources).toContainEqual({ url: "https://example.com/img/b.png", kind: "image" });
  });

  it("handles nested and unquoted forms", () => {
    const { resources } = collectCssResources(
      ".a{background:url( '/x/a.png' )}.b{list:url(/x/b.svg)}",
      "https://example.com",
    );
    expect(resources.map((item) => item.url)).toEqual([
      "https://example.com/x/a.png",
      "https://example.com/x/b.svg",
    ]);
  });
});
