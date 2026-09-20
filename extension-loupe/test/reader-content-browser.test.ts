import { build } from "rolldown";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
// The bundle configuration is intentionally JavaScript because it is also executed by Node.
// @ts-expect-error The repository does not publish declarations for the shared build config.
import { extensionDefinitions, rawAssetPlugin } from "../../rolldown.config.mjs";
import { chromiumTestAvailable, runChromiumDumpDom } from "./chromium-test-launcher.ts";

const repositoryRoot = resolve(import.meta.dirname, "../.."),
  contentScriptBundleConfig = extensionDefinitions["extension-loupe"].bundleConfigs[1];

test("content script renders a parsed page in the browser", async (t) => {
  if (!chromiumTestAvailable()) {
    t.skip("Chromium is not installed at CHROMIUM_BINARY_PATH");
    return;
  }

  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "loupe-reader-content-")),
    chromiumProfileDirectory = resolve(temporaryDirectory, "profile"),
    readerContentBundlePath = resolve(temporaryDirectory, "content.js"),
    readerContentTestPagePath = resolve(temporaryDirectory, "test.html");

  try {
    await build({
      ...contentScriptBundleConfig,
      input: resolve(repositoryRoot, "extension-loupe/src/reader-content-script.ts"),
      plugins: [rawAssetPlugin],
      output: { file: readerContentBundlePath, format: "iife" },
    });
    writeFileSync(
      readerContentTestPagePath,
      `<!doctype html>
<html>
  <body>
    <script>
      let loupeMessageListener;
      window.chrome = {
        runtime: {
          onMessage: { addListener: (listener) => { loupeMessageListener = listener; } },
          sendMessage: async (message) => {
            if (message.action === "parsePage") {
              return {
                ok: true,
                parsedPage: {
                  content: "<h2 id='section'>Section</h2><p>Readable text.</p>",
                  content_markdown: "# Section\\\\n\\\\nReadable text.",
                  title: "Rendered article",
                  author: "",
                  description: "",
                  published: "",
                  site: "",
                  domain: "example.com",
                  extractor_type: null
                }
              };
            }
            if (message.action === "listExtractors") return { extractorNames: [] };
            throw new Error("Unexpected message");
          }
        }
      };
      window.loupeToggleReader = () => loupeMessageListener({ action: "toggle" });
    </script>
      <script src="${readerContentBundlePath}"></script>
    <script>
      loupeToggleReader();
      setTimeout(() => {
        const readerHostElement = document.querySelector('[id^="loupe-reader-host-"]');
        const readerShadowRoot = readerHostElement.shadowRoot;
        document.body.dataset.readerTitle = readerShadowRoot.querySelector("h1").textContent;
        document.body.dataset.readerText = readerShadowRoot.querySelector("article").textContent;
        document.body.dataset.outlineCount = readerShadowRoot.querySelectorAll(".loupe-reader-outline-item").length;
        const readerMenuElement = readerShadowRoot.querySelector(".loupe-reader-menu");
        const readerMenuToggleElement = readerShadowRoot.querySelector('[data-action="menu-toggle"]');
        const menuToggleLeftBeforeOpen = readerMenuToggleElement.getBoundingClientRect().left;
        readerMenuToggleElement.click();
        const menuToggleLeftAfterOpen = readerMenuToggleElement.getBoundingClientRect().left;
        document.body.dataset.menuOpen = String(!readerMenuElement.hidden);
        document.body.dataset.menuToggleStable = String(
          Math.abs(menuToggleLeftAfterOpen - menuToggleLeftBeforeOpen) < 0.5,
        );
      }, 500);
    </script>
  </body>
</html>`,
    );

    const output = runChromiumDumpDom(readerContentTestPagePath, chromiumProfileDirectory);
    assert.match(output, /data-reader-title="Rendered article"/);
    assert.match(output, /data-reader-text="Rendered articleexample\.comSectionReadable text\."/);
    assert.match(output, /data-outline-count="1"/);
    assert.match(output, /data-menu-open="true"/);
    assert.match(output, /data-menu-toggle-stable="true"/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("content script opens Obsidian with a clipboard loupe-import URI", async (t) => {
  if (!chromiumTestAvailable()) {
    t.skip("Chromium is not installed at CHROMIUM_BINARY_PATH");
    return;
  }

  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "loupe-reader-obsidian-")),
    chromiumProfileDirectory = resolve(temporaryDirectory, "profile"),
    readerContentBundlePath = resolve(temporaryDirectory, "content.js"),
    readerContentTestPagePath = resolve(temporaryDirectory, "test.html");

  try {
    await build({
      ...contentScriptBundleConfig,
      input: resolve(repositoryRoot, "extension-loupe/src/reader-content-script.ts"),
      plugins: [rawAssetPlugin],
      output: { file: readerContentBundlePath, format: "iife" },
    });
    writeFileSync(
      readerContentTestPagePath,
      `<!doctype html>
<html>
  <body>
    <script>
      let loupeMessageListener;
      window.__obsidianUrl = "";
      window.__copiedText = "";
      window.__clipboardShouldFail = false;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            if (window.__clipboardShouldFail) throw new Error("clipboard unavailable");
            window.__copiedText = text;
          },
        },
        configurable: true,
      });
      window.chrome = {
        runtime: {
          onMessage: { addListener: (listener) => { loupeMessageListener = listener; } },
          sendMessage: async (message) => {
            if (message.action === "parsePage") {
              return {
                ok: true,
                parsedPage: {
                  content: "<p>Readable text.</p>",
                  content_markdown: "![photo](https://example.com/photo.jpg)",
                  title: "Rendered article",
                  author: "",
                  description: "",
                  published: "",
                  site: "",
                  domain: "example.com",
                  extractor_type: null
                }
              };
            }
            if (message.action === "listExtractors") return { extractorNames: [] };
            if (message.action === "openObsidian") {
              window.__obsidianUrl = message.obsidianUrl;
              return { ok: true };
            }
            throw new Error("Unexpected message");
          }
        }
      };
      window.loupeToggleReader = () => loupeMessageListener({ action: "toggle" });
    </script>
      <script src="${readerContentBundlePath}"></script>
    <script>
      loupeToggleReader();
      setTimeout(() => {
        const readerHostElement = document.querySelector('[id^="loupe-reader-host-"]');
        readerHostElement.shadowRoot.querySelector('[data-action="obsidian"]').click();
      }, 300);
      setTimeout(() => {
        const readerHostElement = document.querySelector('[id^="loupe-reader-host-"]');
        window.__firstObsidianUrl = window.__obsidianUrl;
        window.__firstObsidianStatus = readerHostElement.shadowRoot
          .querySelector(".loupe-reader-status")
          .textContent;
        window.__clipboardShouldFail = true;
        document.execCommand = () => false;
        readerHostElement.shadowRoot.querySelector('[data-action="obsidian"]').click();
      }, 600);
      setTimeout(async () => {
        const readerHostElement = document.querySelector('[id^="loupe-reader-host-"]');
        const obsidianUri = new URL(window.__firstObsidianUrl),
          fallbackUri = new URL(window.__obsidianUrl);
        document.body.dataset.obsidianStatus = window.__firstObsidianStatus;
        document.body.dataset.obsidianAction = obsidianUri.hostname;
        document.body.dataset.obsidianFile = obsidianUri.searchParams.get("file");
        document.body.dataset.obsidianSource = obsidianUri.searchParams.get("source");
        document.body.dataset.obsidianHasContent = String(obsidianUri.searchParams.has("content"));
        document.body.dataset.fallbackAction = fallbackUri.hostname;
        document.body.dataset.fallbackHasContent = String(fallbackUri.searchParams.has("content"));
        document.body.dataset.fallbackStatus = readerHostElement.shadowRoot
          .querySelector(".loupe-reader-status")
          .textContent;
        document.body.dataset.copiedHasTitle = String(
          window.__copiedText.includes('title: "Rendered article"'),
        );
        document.body.dataset.copiedHasImage = String(
          window.__copiedText.includes("![photo](https://example.com/photo.jpg)"),
        );
        const sha256 = obsidianUri.searchParams.get("sha256");
        document.body.dataset.obsidianShaLength = String(sha256.length);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(window.__copiedText),
        );
        const expectedSha256 = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        document.body.dataset.obsidianShaMatch = String(sha256 === expectedSha256);
      }, 800);
    </script>
  </body>
</html>`,
    );

    const output = runChromiumDumpDom(readerContentTestPagePath, chromiumProfileDirectory);
    assert.match(
      output,
      /data-obsidian-status="Opening in Obsidian; image import will continue there/,
    );
    assert.match(output, /data-obsidian-action="loupe-import"/);
    assert.match(output, /data-obsidian-file="Rendered article"/);
    assert.match(output, /data-obsidian-source="file:/);
    assert.match(output, /data-obsidian-has-content="false"/);
    assert.match(output, /data-fallback-action="new"/);
    assert.match(output, /data-fallback-has-content="true"/);
    assert.match(output, /data-fallback-status="Opening in Obsidian/);
    assert.match(output, /data-copied-has-title="true"/);
    assert.match(output, /data-copied-has-image="true"/);
    assert.match(output, /data-obsidian-sha-length="64"/);
    assert.match(output, /data-obsidian-sha-match="true"/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
