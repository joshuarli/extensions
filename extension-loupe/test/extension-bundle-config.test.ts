import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("extension bundle formats match browser loading contracts", () => {
  const extensionBundlerConfigSource = readFileSync(
    new URL("../../rolldown.config.mjs", import.meta.url),
    "utf8",
  );
  assert.match(extensionBundlerConfigSource, /outputOptions\([^)]*"service-worker\.js", "esm"/);
  assert.match(extensionBundlerConfigSource, /outputOptions\([^)]*"content\.js", "iife"/);
});
