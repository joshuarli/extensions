import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPolyglot, containsAsciiInsensitive } from "../../onefile-core/src/polyglot.ts";
import { readStoredArchive } from "../../onefile-core/src/zip.ts";

export async function run(options = {}) {
  const root = process.cwd();
  const pageHtml = readFileSync(resolve(root, "extension-onefile/test/fixtures/article.html"), "utf8");
  const loaderSource = readFileSync(resolve(root, "dist/extension-suite/inject/onefile/loader.js"), "utf8");
  const samples = [];
  const count = options.samples ?? 5;
  for (let iteration = 0; iteration < count; iteration += 1) {
    const resources = Array.from({ length: 64 }, (_, index) => ({
      name: `resources/${index}.bin`,
      mime: "image/png",
      data: new Uint8Array(4096).fill(index % 251),
    }));
    const archive = buildPolyglot({
      pageHtml,
      loaderSource,
      resources,
      sourceUrl: "http://fixture.local/article.html",
      capturedAtMs: 1_700_000_000_000,
      unresolved: [],
    });
    const directory = readStoredArchive(archive.fileBytes);
    if (!containsAsciiInsensitive(archive.fileBytes, "Paragraph 199")) throw new Error("article marker missing from archive");
    if (directory.entries.length < resources.length) throw new Error("archive lost resource entries");
    samples.push({
      bytes: archive.fileBytes.length,
      resources: resources.length,
      entries: directory.entries.length,
      work: resources.length,
    });
  }
  return { name: "onefile-assemble", samples };
}
