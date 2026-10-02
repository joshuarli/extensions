import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

test("extension manifest declares the Loupe MV3 runtime", () => {
  const extensionManifest = JSON.parse(
    readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"),
  ) as {
    name: string;
    manifest_version: number;
    minimum_chrome_version: string;
    permissions: string[];
    background: { service_worker: string };
    icons: Record<string, string>;
    content_security_policy: { extension_pages: string };
  };

  assert.equal(extensionManifest.name, "Loupe");
  assert.equal(extensionManifest.manifest_version, 3);
  assert.equal(extensionManifest.minimum_chrome_version, "150");
  assert.deepEqual(extensionManifest.permissions, [
    "activeTab",
    "scripting",
    "clipboardWrite",
    "downloads",
  ]);
  assert.equal(extensionManifest.background.service_worker, "service-worker.js");
  assert.deepEqual(extensionManifest.icons, {
    "16": "loupe-extension-icon.svg",
    "48": "loupe-extension-icon.svg",
    "128": "loupe-extension-icon.svg",
  });
  assert.match(extensionManifest.content_security_policy.extension_pages, /wasm-unsafe-eval/u);
});
