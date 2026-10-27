# Architecture

One job: toolbar click saves the active tab as a universal self-extracting ZIP. Fixed capture policy, no preferences, no background work.

## Modules

- `src/service-worker.ts` wires `chrome.action.onClicked` to the pipeline with real Chrome dependencies and an in-flight map keyed by tab id.
- `src/workflow.ts` is the Effect pipeline: guard overlap, set badge, run capture, fetch resources at concurrency 6, assemble, download, set the final action state. Every failure maps to a tagged error and an action title; the guard always releases via `Effect.ensuring`.
- `src/inject/capture.ts` is the classic content script. It clones the document with a node map, inlines same-origin stylesheets (with recursive `@import`), absolutizes and tokenizes resource URLs, serializes open shadow roots as declarative templates, inlines adopted stylesheets, snapshots canvases, recurses into same-origin frames, and records everything it cannot reach as `unresolved`.
- `src/polyglot.ts` plus `src/zip.ts` and `src/crc32.ts` build the file: page HTML with loader and index slots, then the stored (uncompressed) ZIP at file-absolute offsets inside the first parse-safe wrapper (`<!--`, `script`, `style`, `noframes`, `noembed`, `iframe`).
- `src/inject/loader.ts` is the classic viewer script. With own-byte access (XHR on the archive URL) it extracts resources to blob URLs and upgrades the page; without it (clean `file://`) it shows the banner and placeholders. Saved page scripts are stripped at capture, so only the loader runs.
- `src/filename.ts` builds `Title (YYYY-MM-DD HH-MM-SS).u.zip.html` and stable `resources/<index>.<ext>` names.
- `src/fetch-resource.ts` fetches one resource with timeout, one retry, and a size cap; `src/downloads.ts` downloads small archives through a data URL and refuses large ones loudly.
- `src/message-contract.ts` validates the capture payload at the boundary; `src/errors.ts` carries kinds the caller can act on; `src/policy.ts` holds the fixed numbers.

## Data flow

Click → `executeScript` returns the payload → Schema decode → parallel resource fetch → token replacement (index-stable) → `buildPolyglot` → `downloads.download` → badge and title update with revert timer.

Cross-tab saves never mix results (in-flight map per tab id); same-tab clicks never overlap (second click gets an "already saving" state); partial fetches never masquerade as success (degraded badge plus `unresolved` list).

## Decisions

The HTML prefix is the saved page itself, so the archive renders natively even where byte access is blocked. Binary resources stay binary ZIP entries; only the small viewer and metadata ride in the prefix. The ZIP uses stored entries with a real CRC32 per file, so `unzip -t` passes and any entry can be sliced out with `prefixLength` from `metadata.json`. Wrapper choice mirrors the upstream oracle minus the rendering wrappers, because this loader never reads page text. Native `fetch` is always called bound (`globalThis.fetch`) since strict-mode bundles throw `Illegal invocation` otherwise.
