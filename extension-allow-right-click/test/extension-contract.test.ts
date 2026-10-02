import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { extensionDefinitions } from "../../vite.config.ts";

test("manifest exposes only the Chromium toolbar toggle runtime", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"),
  ) as {
    action: { default_title: string };
    background: { service_worker: string; type: string };
    manifest_version: number;
    permissions: string[];
  };

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.deepEqual(manifest.background, {
    service_worker: "service-worker.js",
    type: "module",
  });
  assert.match(manifest.action.default_title, /enable or disable/u);
});

test("build config keeps the worker and injected scripts separate", () => {
  const extension = extensionDefinitions["extension-allow-right-click"];
  assert.ok(extension);
  const bundles = extension.bundles;
  const serviceWorkerBundle = bundles[0];
  assert.ok(serviceWorkerBundle);
  assert.equal(serviceWorkerBundle.entryFileName, "service-worker.js");
  assert.equal(serviceWorkerBundle.format, "es");
  assert.equal(serviceWorkerBundle.target, "chrome110");
  assert.equal(serviceWorkerBundle.emptyOutDir, true);
  assert.equal(typeof serviceWorkerBundle.input, "string");
  if (typeof serviceWorkerBundle.input === "string") {
    assert.match(serviceWorkerBundle.input, /service-worker\.ts$/u);
  }
  assert.deepEqual(
    bundles.slice(1).map(({ entryFileName, format }) => ({ entryFileName, format })),
    [
      { entryFileName: "data/inject/core.js", format: "iife" },
      { entryFileName: "data/inject/mouse.js", format: "iife" },
      { entryFileName: "data/inject/styles.js", format: "iife" },
      { entryFileName: "data/inject/user-select/isolated.js", format: "iife" },
      { entryFileName: "data/inject/user-select/main.js", format: "iife" },
      { entryFileName: "data/inject/listen/isolated.js", format: "iife" },
      { entryFileName: "data/inject/listen/main.js", format: "iife" },
    ],
  );
});
