import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  const config = readFileSync(new URL("../../rolldown.config.mjs", import.meta.url), "utf8");

  assert.match(config, /esmBundle\([^)]*"service-worker\.js", true\)/u);
  assert.match(config, /classicBundle[\s\S]*?outputOptions[\s\S]*?"iife"/u);
  assert.doesNotMatch(config, /data\/options|data\/monitor|context\.ts|inject\/test/u);
});
