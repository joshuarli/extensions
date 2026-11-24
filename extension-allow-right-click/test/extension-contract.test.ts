import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { featureManifests, manifest } from "../../extension-suite/src/manifest.ts";
import { suiteBundles } from "../../vite.config.ts";

test("composes a manifest fragment from every extension package", () => {
  const packages = readdirSync(new URL("../..", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^extension-(?!suite$)/u.test(entry.name));
  expect(packages.map((entry) => entry.name).sort()).toEqual([
    "extension-allow-right-click",
    "extension-chatgpt",
    "extension-onefile",
    "extension-x-archive",
    "extension-youtube-transcript",
  ]);
  expect(featureManifests).toHaveLength(packages.length);
});

test("composes one manifest from the feature fragments", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Browser Extensions");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.minimum_chrome_version, "120");
  assert.deepEqual(manifest.background, {
    service_worker: "service-worker.js",
    type: "module",
  });
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.options_page, "options.html");
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "scripting",
    "downloads",
    "offscreen",
    "clipboardWrite",
    "notifications",
    "declarativeNetRequestWithHostAccess",
    "storage",
    "cookies",
    "webRequest",
  ]);
  assert.deepEqual(manifest.host_permissions, [
    "https://www.youtube.com/*",
    "https://m.youtube.com/*",
    "https://youtube.com/*",
    "https://youtu.be/*",
    "https://x.com/*",
    "https://chatgpt.com/*",
  ]);
  assert.ok(!("content_scripts" in manifest));
  assert.deepEqual(manifest.declarative_net_request, {
    rule_resources: [
      {
        id: "youtube-headers",
        enabled: true,
        path: "rules/youtube-headers.json",
      },
    ],
  });
  assert.deepEqual(manifest.externally_connectable, {
    matches: ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://youtube.com/*"],
  });
});

test("builds one worker, one UI bundle, and namespaced classic injections", () => {
  const worker = suiteBundles.find((bundle) => bundle.entryFileName === "service-worker.js");
  assert.ok(worker);
  assert.equal(worker.format, "es");
  assert.equal(worker.target, "chrome120");
  assert.match(String(worker.input), /extension-suite\/src\/service-worker\.ts$/u);

  const ui = suiteBundles.find(
    (bundle) => typeof bundle.input === "object" && "popup" in bundle.input,
  );
  assert.ok(ui);
  assert.equal(ui.format, "es");
  assert.equal(ui.entryFileName, "[name].js");

  const injected = suiteBundles.filter((bundle) => bundle.entryFileName.startsWith("inject/"));
  assert.deepEqual(
    injected.map(({ entryFileName, format }) => ({ entryFileName, format })),
    [
      { entryFileName: "inject/allow-right-click/core.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/mouse.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/styles.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/user-select/isolated.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/user-select/main.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/listen/isolated.js", format: "iife" },
      { entryFileName: "inject/allow-right-click/listen/main.js", format: "iife" },
      { entryFileName: "inject/onefile/capture.js", format: "iife" },
      { entryFileName: "inject/onefile/loader.js", format: "iife" },
    ],
  );

  const onefileOffscreen = suiteBundles.find(
    (bundle) => bundle.entryFileName === "offscreen.js",
  );
  assert.ok(onefileOffscreen);
  assert.match(onefileOffscreen.outputDirectory, /features\/onefile$/u);

  const chatgptDashboard = suiteBundles.find((bundle) =>
    typeof bundle.input === "object" && "dashboard" in bundle.input,
  );
  assert.ok(chatgptDashboard);
  assert.equal(chatgptDashboard.format, "es");
  assert.match(chatgptDashboard.outputDirectory, /features\/chatgpt$/u);
});
