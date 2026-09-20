import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
// @ts-expect-error The repository does not publish declarations for the shared build config.
import { extensionDefinitions, outputRoot } from "../../rolldown.config.mjs";

test("extensions share one repository-level output root", () => {
  const definitions = extensionDefinitions as Record<string, { outputDirectory: string }>;
  for (const [extensionName, extension] of Object.entries(definitions)) {
    assert.equal(extension.outputDirectory, resolve(outputRoot, extensionName));
  }
});

test("extension bundle formats match browser loading contracts", () => {
  const extensionBundlerConfigSource = readFileSync(
    new URL("../../rolldown.config.mjs", import.meta.url),
    "utf8",
  );
  assert.match(extensionBundlerConfigSource, /outputOptions\([^)]*"service-worker\.js", "esm"/);
  assert.match(extensionBundlerConfigSource, /outputOptions\([^)]*"content\.js", "iife"/);
});
