# Loupe

Loupe is a Chromium Manifest V3 reader extension. Clicking its toolbar icon opens or hides a reader overlay in the current page.

## Page extraction

The on-demand content script sends the page's outer HTML and URL to the service worker. The worker calls the sibling `defuddle-rs` WebAssembly adapter and returns a narrow [`LoupeParsedPage` message type](../extension-loupe/src/extension-messages.ts). The content script renders the adapter's `content` field as HTML and uses the extracted title as the article heading.

The content script caches a parsed result only if the document URL still matches the URL captured before extraction completes. When extraction fails, it restores the page's original scroll styles and leaves a dismissible error overlay. It offers extractor selection, copies extracted HTML or Markdown with YAML frontmatter, and can open the Markdown in Obsidian. Date-only publication metadata keeps its calendar day in the reader and exported Markdown. The Obsidian action copies the Markdown first; if clipboard access fails, it uses the URI's content parameter.

The reader lives in a Shadow DOM. Its [markup](../extension-loupe/src/reader-overlay.html) and [stylesheet](../extension-loupe/src/reader-overlay.css) are imported by the content script; [fixture serialization](../extension-loupe/src/reader-fixture.ts) captures the rendered UI with inline CSS.

## Build constraints

- The service worker is an ES module. The on-demand content script is an IIFE classic script because Chrome injects it without module support.
- The sibling `defuddle-rs` checkout owns the WebAssembly parser. Keep the TypeScript message type narrow and update it with adapter contract changes.
- [The WASM build script](../scripts/build-defuddle-wasm.mjs) generates optimized WASM in an ignored intermediate directory; the production bundle copies the generated module into the extension directory.
- [The sample fixture builder](../scripts/build-reader-sample-fixture.mjs) generates the tracked reader fixture from [its source HTML](../extension-loupe/test/fixtures/reader-sample-source.html).

See [shared build prerequisites](development.md#loupe-wasm-build) before building.
