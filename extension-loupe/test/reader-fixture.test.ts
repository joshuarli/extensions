import { build } from "rolldown";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { chromiumTestAvailable, runChromiumDumpDom } from "./chromium-test-launcher.ts";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("reader fixture serialization works in Chromium", async (t) => {
  if (!chromiumTestAvailable()) {
    t.skip("Chromium is not installed at CHROMIUM_BINARY_PATH");
    return;
  }
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "loupe-reader-fixture-")),
    chromiumProfileDirectory = resolve(temporaryDirectory, "profile"),
    fixtureBrowserBundlePath = resolve(temporaryDirectory, "entry.js"),
    fixtureBrowserTestPagePath = resolve(temporaryDirectory, "test.html");

  try {
    await build({
      input: resolve(repositoryRoot, "extension-loupe/test/reader-fixture-browser-entry.ts"),
      output: { file: fixtureBrowserBundlePath, format: "iife" },
      transform: { target: "chrome150" },
    });
    writeFileSync(
      fixtureBrowserTestPagePath,
      `<!doctype html><html><body><script src="${
        fixtureBrowserBundlePath
      }"></script></body></html>`,
    );
    const chromiumDumpDomOutput = runChromiumDumpDom(
      fixtureBrowserTestPagePath,
      chromiumProfileDirectory,
    );
    assert.match(chromiumDumpDomOutput, /Rendered title/);
    assert.match(chromiumDumpDomOutput, /color: red/);
    assert.doesNotMatch(chromiumDumpDomOutput, /loupe-reader-progress/);
    assert.match(chromiumDumpDomOutput, /loupe-reader-toolbar/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
