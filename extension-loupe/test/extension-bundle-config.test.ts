import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "vitest";
import { extensionDefinitions, outputRootPath } from "../../vite.config.ts";

test("extensions share one repository-level output root", () => {
  for (const [extensionName, extension] of Object.entries(extensionDefinitions)) {
    assert.equal(extension.outputDirectory, resolve(outputRootPath, extensionName));
  }
});

test("extension bundle formats match browser loading contracts", () => {
  const loupeExtension = extensionDefinitions["extension-loupe"];
  assert.ok(loupeExtension);
  const loupeBundles = loupeExtension.bundles;
  assert.deepEqual(
    loupeBundles.map(({ entryFileName, format }) => ({ entryFileName, format })),
    [
      { entryFileName: "service-worker.js", format: "es" },
      { entryFileName: "content.js", format: "iife" },
    ],
  );
});
