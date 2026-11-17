# Onefile

Saves the active tab as a universal self-extracting ZIP (`.u.zip.html`): a page that opens offline under `file://` and also passes `unzip -t`.

Onefile is one feature of the unified extension. For browser installation, follow the [repository README](../README.md) and load `build/extension-suite` (development) or `dist/extension-suite` (production) as an unpacked extension.

For terminal capture, see the [Onefile CLI](../onefile-cli/README.md).

## Use

Open the toolbar popup and choose **Save page**. The extension captures the tab, builds the archive, and downloads `Page Title (2026-10-27 15-30-00).u.zip.html`. The badge shows save progress as a percentage and the title shows the fetched file count, `!` with a count when files were missing, and both clear on success. Restricted pages (for example `chrome://`) fail loudly through the action title.

Open the file over `http(s)` served by a server that serves the archive's entries at their paths (such as `laputa-systems/srv`) for full fidelity — scripts re-run, CSS-referenced resources resolve at their archive paths, and the page's own boot sequence replays. A plain static server 404s the archived module graph and the page falls back to its own failure path; via `file://` you get text and layout with image placeholders. `unzip -t` validates the embedded archive. See [FORMAT.md](FORMAT.md) for the layout and [PERFORMANCE.md](PERFORMANCE.md) for budgets.

Page scripts are part of the archive: same-origin `<script src>` and the ES-module graph they pull in are stored at their origin paths, so the page re-runs its own boot code on open (animations, canvas scenes, scripted layout) instead of freezing the capture-time frame. Cross-origin scripts are kept as hotlinks, and `<noscript>` fallbacks are dropped because archives always run JavaScript. Save whenever; the intro replays on open.

## Permissions

| Permission | Call sites |
| --- | --- |
| `activeTab` | Capture injection target; same-origin resource fetches ride on the tab grant, so no host permissions are needed. |
| `scripting` | `executeScript` runs `inject/onefile/capture.js` in the tab and invokes its entry point. |
| `downloads` | `downloads.download` saves the finished archive with uniquify on collision. |
| `offscreen` | An offscreen document creates the blob URL used for the archive download, because MV3 service workers do not expose `URL.createObjectURL`. |

Onefile has no settings of its own; it is launched from the suite popup. Anything the capture cannot reach is listed in the archive banner and `metadata.json`, never silently dropped.

## Limits

- Archives download through a blob URL created by an offscreen document, so only available memory bounds their size; each fetched resource is still capped at 5 MB.
- Cross-origin subresources the page grant cannot read stay unresolved.
- Closed shadow roots are invisible to page scripts and are kept as plain elements.
- See [UPSTREAM.md](UPSTREAM.md) for provenance and [ARCHITECTURE.md](ARCHITECTURE.md) for the pipeline.
