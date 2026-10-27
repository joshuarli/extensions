import { describe, expect, it } from "vitest";
import {
  buildPolyglot,
  containsAsciiInsensitive,
  fillLoaderSlot,
  injectLoaderSlot,
  injectMetadataSlot,
  selectZipWrapper,
} from "../src/polyglot.ts";
import { extractStoredEntry, readStoredArchive } from "../src/zip.ts";

const textDecoder = new TextDecoder();

const samplePage =
  '<!DOCTYPE html><html><head><title>Sample</title></head><body><p>hello</p><img src="onefile-resource-0"></body></html>';

describe("loader slot", () => {
  it("lands before the body close and fills exactly once", () => {
    const slotted = injectLoaderSlot(samplePage);
    expect(slotted.indexOf('<script id="onefile-loader"></script>')).toBeGreaterThan(-1);
    expect(slotted.indexOf("</body>")).toBeGreaterThan(slotted.indexOf('<script id="onefile-loader"></script>'));
    const filled = fillLoaderSlot(slotted, "globalThis.x = 1;");
    expect(filled).toContain("globalThis.x = 1;");
    expect(filled).not.toContain('<script id="onefile-loader"></script>');
  });

  it("embeds the archive index without breaking script parsing", () => {
    const slotted = injectMetadataSlot(samplePage, {
      sourceUrl: "https://example.com/?a=<b>",
      capturedAtMs: 1,
      unresolvedTotal: 0,
      unresolvedSample: [],
      entries: [],
    });
    expect(slotted).toContain("\\u003cb>");
    expect(slotted).not.toContain("<b>");
  });
});

describe("polyglot archive", () => {
  const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

  function build() {
    return buildPolyglot({
      pageHtml: samplePage,
      loaderSource: "globalThis.onefileProbe = true;",
      resources: [{ name: "resources/0.png", mime: "image/png", data: imageBytes }],
      sourceUrl: "https://example.com/",
      capturedAtMs: 1_700_000_000_000,
      unresolved: [{ url: "https://example.com/missing.png", reason: "HTTP 404" }],
    });
  }

  it("parses through the appended zip with file-absolute offsets", () => {
    const archive = build(),
      directory = readStoredArchive(archive.fileBytes);
    expect(directory.entries.map((entry) => entry.name)).toEqual(["resources/0.png", "metadata.json"]);
    expect(extractStoredEntry(directory, "resources/0.png")).toEqual(imageBytes);
    const metadata = JSON.parse(textDecoder.decode(extractStoredEntry(directory, "metadata.json"))) as {
      prefixLength: number;
      sourceUrl: string;
    };
    expect(metadata.prefixLength).toBe(archive.prefixLength);
    expect(metadata.sourceUrl).toBe("https://example.com/");
  });

  it("selects the comment wrapper for clean bytes and later wrappers for hostile bytes", () => {
    const clean = selectZipWrapper(new Uint8Array([1, 2, 3]));
    expect(clean).toEqual({ open: "<!--", close: "-->" });
    const hostile = selectZipWrapper(new TextEncoder().encode("a --> b </script> c </style> d"));
    expect(hostile).toEqual({ open: "<noframes>", close: "</noframes>" });
    expect(containsAsciiInsensitive(new TextEncoder().encode("x </SCRIPT> y"), "</script")).toBe(true);
  });

  it("falls back past the comment wrapper when resource bytes close it", () => {
    const hostileBytes = new TextEncoder().encode("-->"),
      archive = buildPolyglot({
        pageHtml: samplePage,
        loaderSource: "/*loader*/",
        resources: [{ name: "resources/0.bin", mime: "application/octet-stream", data: hostileBytes }],
        sourceUrl: "https://example.com/",
        capturedAtMs: 1_700_000_000_000,
        unresolved: [],
      }),
      directory = readStoredArchive(archive.fileBytes);
    expect(directory.entries.map((entry) => entry.name)).toContain("resources/0.bin");
    const prefixText = textDecoder.decode(archive.fileBytes.subarray(0, archive.prefixLength));
    expect(prefixText.endsWith('<script type="onefile-data">')).toBe(true);
  });

  it("keeps the html prefix renderable and resource bytes out of it", () => {
    const archive = build(),
      prefixText = textDecoder.decode(archive.fileBytes.subarray(0, archive.prefixLength));
    expect(prefixText).toContain("<!DOCTYPE html>");
    expect(prefixText).toContain("globalThis.onefileProbe = true;");
    expect(prefixText).toContain('id="onefile-metadata"');
    const base64Image = Buffer.from(imageBytes).toString("base64");
    expect(prefixText).not.toContain(base64Image);
  });
});
