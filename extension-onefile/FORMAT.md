# Format

A `.u.zip.html` file renders as a page and extracts as a ZIP. This document describes the bytes so you can validate or recover them without the extension.

## Layout

The file holds three parts in order:

1. The saved page (HTML). It ends with the banner slot, the loader script, the archive index script, and the opening of one wrapper tag.
2. The ZIP bytes (stored entries, no compression).
3. The wrapper close tag.

The ZIP starts at byte `prefixLength` and uses file-absolute offsets, so `unzip -t` passes directly.

## ZIP entries

- `resources/<index>.<ext>`: captured images, fonts, and imported stylesheets, byte-identical to the download. The extension in the name follows the served MIME type.
- `<origin-path>`: same-origin scripts, stored at their origin paths (for example `startup.js`, `vendor/garden-art.js`, `material-worker.js`) so ES-module specifiers, dynamic `import()`, `new URL(..., import.meta.url)`, and module workers resolve unchanged when the archive re-runs the page.
- `metadata.json`: the manifest below.

`prefixLength` is the byte length of part 1. Slice the file at that offset to recover a plain ZIP.

## metadata.json

- `generator`: always `extension-onefile`.
- `sourceUrl`: the saved tab URL.
- `capturedAtMs`: save time in milliseconds.
- `prefixLength`: byte offset where the ZIP starts.
- `entries`: one object per resource entry with `name`, `mime`, `size`, and `crc32`.
- `unresolved`: resources the capture could not reach, each with `url` and `reason`.

## Archive index

The prefix carries `<script id="onefile-metadata" type="application/json">` with `sourceUrl`, `capturedAtMs`, `unresolvedTotal`, a 25-item `unresolvedSample`, and entry names with MIME types. Angle brackets are `\u003c`-escaped so the block never breaks parsing.

## Loader behavior

When the archive URL serves its own bytes over `http(s)`, the loader extracts each entry, mints a blob URL per MIME type, and swaps the `resources/` references in place. When byte access is blocked (clean `file://`), it shows the banner with source, timestamp, and missing-file count, and swaps images for placeholders. The banner element is `<div id="onefile-banner">`.

## Scripts

The archive always runs JavaScript — the loader is a script — so capture keeps the page's scripts, unlike the no-JavaScript world it replaces. Same-origin `<script src>` elements are archived at their origin paths, and the capture walks their module graph (static imports, dynamic `import()`, and `new URL(...)` specifiers up to 256 modules), archiving each same-origin module at its origin path too. The page's own boot code then re-runs at open, which is what reproduces animation, scripted layout, and canvas scenes rather than freezing the capture-time frame. Canvases are kept as canvases, not replaced with image snapshots. Fragment-only CSS references such as `url(#material-0)` stay verbatim; absolute same-document fragment references are normalized to the same form, and foreign-file fragment references keep their fragment.

Cross-origin `<script src>` elements are never archived; they stay hotlinks, exactly as on the live page. `<noscript>` content is dropped at capture, because the archive always has scripting enabled — the loader is a script — which is what governs `<noscript>` in a live browser.

Two consequences. First, a server that serves archive entries at their origin paths (like `laputa-systems/srv`) is required for script archives to boot; a plain static server 404s the module graph and the page falls back to whatever its own failure path shows. Second, ES modules and `fetch` are CORS-blocked on `file://`, so on `file://` a script archive shows the page's static markup with image placeholders, never the animation. Save while the page is in any state; the intro or boot sequence re-runs from the archived state on open.

## Limits

Entry counts, sizes, and offsets must fit 32-bit ZIP fields; anything larger fails loudly before writing. The wrapper is the first of `<!--`, `script`, `style`, `noframes`, `noembed`, `iframe` whose terminator is absent from the ZIP bytes; if none fits, the build fails instead of emitting an unparseable file.
