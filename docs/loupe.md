# Loupe

Loupe is a Chromium Manifest V3 reader extension. Clicking its toolbar icon opens or hides a reader overlay in the current page.

## Page extraction

The on-demand content script sends the page's outer HTML and URL to the service worker. The worker calls the sibling `defuddle-rs` WebAssembly adapter and returns a narrow [`LoupeParsedPage` message type](../extension-loupe/src/extension-messages.ts). The content script renders the adapter's `content` field as HTML and uses the extracted title as the article heading.

The content script caches a parsed result only if the document URL still matches the URL captured before extraction completes. When extraction fails, it restores the page's original scroll styles and leaves a dismissible error overlay. It offers extractor selection, copies extracted HTML or Markdown with YAML frontmatter, and can open the Markdown in Obsidian or send it to Tansu. Date-only publication metadata keeps its calendar day in the reader and exported Markdown. The Obsidian action copies the Markdown first; if clipboard access fails, it uses the URI's content parameter.

The reader lives in a Shadow DOM. Its [markup](../extension-loupe/src/reader-overlay.html) and [stylesheet](../extension-loupe/src/reader-overlay.css) are imported by the content script; [fixture serialization](../extension-loupe/src/reader-fixture.ts) captures the rendered UI with inline CSS.

## Sending to Tansu

The reader menu's **Send to Tansu** item and the `send-to-tansu` command run one flow. The command (default Ctrl+Shift+S, Command+Shift+S on macOS; rebind at chrome://extensions/shortcuts) extracts the active tab through the same parse path without opening the reader and reports progress in a small shadow-DOM toast. If the page cannot run the content script, the toolbar badge shows `!`. When no Tansu URL is saved, the command opens the options page.

The [options page](../extension-loupe/src/options.html) stores one setting, the Tansu origin, in `chrome.storage.local`. Input is reduced to an http(s) origin and validated with [Schema](../extension-loupe/src/tansu-schemas.ts).

The content script sends `{ action: "sendToTansu", title, markdown, sourceUrl }` to the service worker, which validates it and then, in [one Effect program](../extension-loupe/src/tansu-send.ts):

1. Rewrites every standard remote Markdown image embed to `![alt](tansu-import-image:ID)` and fetches the bytes from the service worker ([`tansu-import.ts`](../extension-loupe/src/tansu-import.ts)). If a link wraps an image and both URLs resolve to the same image, Loupe drops the link when it localizes the image. Links to other destinations stay intact. Four fetches run at once. Retries use exponential backoff for 408, 425, 429, and 5xx. Only http(s) URLs with an `image/*` content type qualify; each image is at most 10 MB and the total is at most 40 MB in source order. An image that fails or exceeds a cap stays remote: Tansu receives its URL with `base64: null`.
2. Reuses an open tab on the Tansu origin or creates one with `active: false`, waits for it to load, and injects the classic bundle `tansu-import-page.js`. If the page does not post `import.ready` within 3 seconds, Loupe activates the tab (the user probably has to sign in) and keeps waiting up to 3 minutes in total.
3. Posts the request and waits up to 2 minutes for the matching result, which is decoded with Schema. The reader shows "Imported to Tansu · N images" with an **Open note** action that focuses the Tansu tab. Missing configuration shows an **Open settings** action.

While the flow runs, the service worker pings a cheap extension API every 20 seconds so Chrome does not stop it during the 5-minute worst case.

### Protocol

Loupe and the Tansu page exchange same-origin `window.postMessage` messages, all with `channel: "tansu"` and `version: 1`. Both sides ignore messages whose `event.source` is not the window or whose origin differs.

- Tansu posts `import.ready` when it can accept an import, and replies with it to `{ channel: "tansu", type: "import.ping" }`. Loupe re-pings every second while waiting.
- Loupe posts `import.request` with `requestId`, `title`, `markdown` (the full note including frontmatter), `sourceUrl`, and `images: { id, url, contentType, base64 | null }[]`. `images[ID]` belongs to the placeholder `tansu-import-image:ID`.
- Tansu answers `import.result` with the same `requestId` and either `ok: true, noteId, path, imagesLocalized, imagesFailed` or `ok: false, error`.

Tansu converts to WebP and uploads; Loupe only fetches bytes. Bytes cross `executeScript` as base64. `executeScript` drops `null` properties from arguments, so the call is passed as one JSON string that the injected function parses, which keeps `base64: null` intact.

The Markdown image scanner in [`loupe-image-scanner.ts`](../extension-loupe/src/loupe-image-scanner.ts) is a verbatim port of `findLoupeImageOccurrences` and `resolveLoupeImageUrl` (with their code-fence and inline-code handling) from `obsidian-webp-paste/src/loupe-import.ts`. The retry and bounded-concurrency helpers mirror the same file. The scanner tests port that plugin's `test/loupe-import.test.ts` cases, so a behavior change should land in both repositories.

## Permissions

Loupe declares `host_permissions: ["<all_urls>"]`, plus `storage`. The extension is a personal unpacked build, and one grant avoids permission prompts: the service worker fetches article images from arbitrary origins without CORS, and it injects into the user-configured Tansu origin, which is not known at build time. The tradeoff is that Loupe can read and script every site. Do not publish it to a store with this manifest; a published build should use `optional_host_permissions` and request the Tansu origin and image access at runtime.

## Build constraints

- The service worker and options page are ES modules. The on-demand content script and the Tansu page script are IIFE classic scripts because Chrome injects them without module support. Keep Effect out of the Tansu page script; the service worker validates its results.
- The sibling `defuddle-rs` checkout owns the WebAssembly parser. Keep the TypeScript message type narrow and update it with adapter contract changes.
- [The WASM build script](../scripts/build-defuddle-wasm.mjs) generates optimized WASM in an ignored intermediate directory; the production bundle copies the generated module into the extension directory.
- [The sample fixture builder](../scripts/build-reader-sample-fixture.mjs) generates the tracked reader fixture from [its source HTML](../extension-loupe/test/fixtures/reader-sample-source.html).

See [shared build prerequisites](development.md#loupe-wasm-build) before building.
