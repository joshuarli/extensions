import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildPolyglot } from "../src/polyglot.ts";
import { extractStoredEntry, readStoredArchive } from "../src/zip.ts";

const textDecoder = new TextDecoder();

const goldenPage =
  '<!DOCTYPE html><html><head><title>Golden</title><style>p{color:red}</style></head><body><p>golden body</p><img src="onefile-resource-0"><img src="onefile-missing"></body></html>';

function buildGolden() {
  return buildPolyglot({
    pageHtml: goldenPage,
    loaderSource: "/*golden-loader*/",
    resources: [{ name: "resources/0.png", mime: "image/png", data: new Uint8Array([1, 2, 3, 4, 5]) }],
    sourceUrl: "https://example.com/golden",
    capturedAtMs: 1_700_000_000_000,
    unresolved: [{ url: "https://example.com/gone.png", reason: "HTTP 404" }],
  });
}

describe("golden archive bytes", () => {
  it("keeps the exact byte layout stable", () => {
    const archive = buildGolden(),
      digest = createHash("sha256").update(archive.fileBytes).digest("hex");
    expect(digest).toBe("80029fe4321e39671d0230f13e75a11e0e99bcf5a358a54e92791bfc203d3220");
    expect(archive.fileBytes.length).toBeGreaterThan(archive.prefixLength);
    const directory = readStoredArchive(archive.fileBytes),
      metadata = JSON.parse(textDecoder.decode(extractStoredEntry(directory, "metadata.json"))) as {
        generator: string;
        sourceUrl: string;
        prefixLength: number;
      };
    expect(metadata.generator).toBe("extension-onefile");
    expect(metadata.sourceUrl).toBe("https://example.com/golden");
    expect(metadata.prefixLength).toBe(archive.prefixLength);
  });
});
