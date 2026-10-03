# Loupe Agent Guide

## Purpose

Loupe is a Chrome Manifest V3 reader-mode extension. It snapshots the current
page, sends static HTML and the page URL to `defuddle-rs` compiled to
WebAssembly, and renders the extracted content in an in-page reader overlay.

## Structure

- `src/service-worker.ts` is the MV3 service worker. It handles
  toolbar clicks, injects the content script on demand, initializes WASM, and
  parses pages.
- `src/reader-content-script.ts` runs in the page’s isolated world. It owns
  the reader overlay, icon-driven show/hide state, rendering, and copying.
- `src/reader-markdown.ts::createReaderMarkdownFromPage()` adds the reader
  metadata frontmatter shared by Markdown copying, Obsidian import, and fixture
  downloads.
- `src/reader-overlay.css` contains the reader stylesheet and
  `src/reader-overlay.html` contains its Shadow DOM markup. Vite embeds the CSS
  from the content-script entry through its raw asset import.
- `src/reader-fixture.ts::serializeReaderUi()` converts the rendered Shadow DOM
  into a standalone fixture with inline CSS.
- `src/download-filename.ts::sanitizeDownloadFilename()` defines the shared
  download filename contract.
- `src/defuddle-wasm-client.ts::parsePageWithWasm()` and
  `src/defuddle-wasm-client.ts::listWasmExtractors()` are the TypeScript
  wrappers around the generated WASM bindings.
- `src/error-logging.ts::getErrorMessage()` and
  `src/error-logging.ts::logLoupeError()` define extension error reporting.
- `src/extension-messages.ts` contains the service-worker request/response
  contracts and the `LoupeParsedPage` result shared by the worker and content
  script.
- `../scripts/build-defuddle-wasm.mjs` builds the sibling Rust adapter and runs
  `wasm-bindgen`.
- `../scripts/build-extensions.mjs` invokes Vite to bundle all extensions and copies the
  generated WASM file.
- `../scripts/build-reader-sample-fixture.mjs` builds the tracked reader fixture
  from `test/fixtures/reader-sample-source.html`.
- `../vite.config.ts` defines extension bundle entries and emits the module
  service worker and self-contained IIFE injected by
  `chrome.scripting.executeScript()`.
- `../build/extension-loupe/` and `../dist/extension-loupe/` are generated
  extension directories. `.generated/` is the ignored intermediate
  WASM-bindgen directory.

The Rust source of truth is the sibling `defuddle-rs` checkout. Its
`crates/defuddle` crate performs extraction; `crates/defuddle-wasm` exposes the
browser boundary.

## Terminology

- A raw page snapshot is the original document HTML collected by
  `snapshotCurrentPageHtml()`.
- A parsed page is the narrow `LoupeParsedPage` returned by
  `parsePageWithWasm()`.
- Reader state is the rendered DOM owned by `reader-content-script.ts`,
  including `readerHostElement`, `readerArticleElement`, and
  `readerOutlineNavigationElement`.
- Fixture outputs are the raw HTML, extracted HTML, Markdown, and standalone UI
  HTML produced by `downloadReaderFixtureBundle()`,
  `serializeReaderUi()`, and the reader sample fixture builder.

## Runtime boundary

The browser passes `document.documentElement.outerHTML` and `document.URL` as
strings. Rust does not receive browser DOM objects, computed styles, page
JavaScript state, or shadow-root internals.

The WASM adapter exposes only this JSON payload:

```json
{
  "content": "...sanitized extracted HTML...",
  "content_markdown": "...markdown...",
  "title": "...",
  "author": "...",
  "description": "...",
  "published": "...",
  "site": "...",
  "domain": "...",
  "extractor_type": "..."
}
```

Do not expose `DefuddleResult` directly to the extension. Add fields to the
narrow adapter result only when the reader UI needs them.

`crates/defuddle-wasm/src/lib.rs::parse_page()` enables `separate_markdown` and
`remove_iframes` before calling `defuddle::parse_html()`. The extraction
pipeline then runs `sanitize::remove_iframes()` and
`sanitize::strip_unsafe_elements()` before returning `content`; the sanitizer
contract is tested in `crates/defuddle/src/sanitize.rs`. The extension may render
that owned, sanitized HTML directly. If the Rust output contract changes, update
the adapter result and its Rust tests together with `src/extension-messages.ts`.

The reader renders sanitized extracted HTML directly, inserting the extracted
title as the article’s top-level `h1`. It does not add a JavaScript Markdown
parser. Markdown buttons copy extracted Markdown with YAML frontmatter; HTML
buttons copy raw extracted HTML. The extension icon is the only show/hide
control; the reader has no refresh control.

The Rust sanitizer is the owned trust boundary for extracted HTML. The reader
does not duplicate that sanitization in TypeScript.

## Build and test

The default layout expects `../defuddle-rs`. For another location, set
`DEFUDDLE_RS_DIR`.

```bash
cd ..
deno task bootstrap
pnpm install
pnpm run dist
pnpm run test
pnpm run test:browser
```

The repository-root `package.json` pins TypeScript 7, Vite 8, Effect 4,
Vitest 5, Oxlint, and the `@types/*` packages; `pnpm-lock.yaml` pins their
resolved versions. `pnpm run typecheck` runs TypeScript 7 (`tsc --noEmit`)
against `tsconfig.json`, which enables every `strict`-family flag.
`pnpm run test` runs the unit suite; `pnpm run test:browser` runs browser
behavior tests with Vitest Browser Mode and the Playwright provider.

The Rust adapter requires the `wasm32-unknown-unknown` target and
matching `wasm-bindgen` CLI and Binaryen releases. When `wasm-bindgen` is
missing, the build installs a CLI matching the `wasm-bindgen` crate version
in the sibling checkout’s `Cargo.lock` via `cargo install`; set
`WASM_BINDGEN` to override the binary location. When the
`wasm32-unknown-unknown` target is missing, the build adds it via `rustup`.
When `wasm-opt` is missing on macOS with Homebrew available, the build
installs Binaryen via `brew install binaryen`. The build runs
Binaryen’s `wasm-opt -Oz --strip-debug`; set `WASM_OPT` if the
executable is not on `PATH` or in a standard Homebrew location.
Cargo uses the size-oriented `wasm-release` profile for this target: it uses
size optimization, fat LTO, one codegen unit, aborting panics, and stripped
symbols. PGO is intentionally omitted because build time matters during
extension iteration.

Rust validation runs from `defuddle-rs`:

```bash
cargo test --workspace
cargo check --workspace --target wasm32-unknown-unknown
```

Set `CHROMIUM_BINARY_PATH` to choose the Chromium executable for Browser Mode.
The default path is `/Applications/Chromium.app/Contents/MacOS/Chromium` when
that file exists; otherwise the Playwright provider uses its managed browser.

Load `dist/extension-loupe/` as an unpacked extension. Click the Loupe toolbar
icon to show or hide the reader. The first click parses the current DOM; subsequent toggles
reuse the result until the document URL changes.

The reader toolbar’s Open in Obsidian button first copies the complete
extracted Markdown to the clipboard and opens `obsidian://new` with the
extracted title in a `file` query parameter, following the
`obsidian-clipper` clipboard-first convention. If clipboard access fails, it
falls back to the URL-encoded `content` query parameter with the same note
name. Loupe asks its service worker to navigate the current tab to the
Obsidian URL, so the browser hands focus to Obsidian without opening an
intermediate blank tab.

The background service worker is loaded as an ES module, but the on-demand
content script is injected as a classic script. Keep those bundle formats
separate; a top-level import in build/content.js causes the browser to reject
the injected script with “Cannot use import statement outside a module.”

Do not run pre-commit hooks or push changes. Do not add banner/separator
comments. Prefer the smallest implementation and preserve useful comments.
