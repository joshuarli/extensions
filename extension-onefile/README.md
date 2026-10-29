# Onefile

Saves the active tab as a universal self-extracting ZIP (`.u.zip.html`): a page that opens offline under `file://` and also passes `unzip -t`.

For browser installation, follow the [repository README](../README.md) and load `build/extension-onefile` (development) or `dist/extension-onefile` (production) as an unpacked extension.

## Use

Click the toolbar button on any ordinary page. The extension captures the tab, builds the archive, and downloads `Page Title (2026-10-27 15-30-00).u.zip.html`. The badge shows save progress as a percentage and the title shows the fetched file count, `!` with a count when files were missing, and both clear on success. Restricted pages (for example `chrome://`) fail loudly through the action title.

Open the file over `http(s)` for full fidelity, or via `file://` for text and layout with image placeholders. `unzip -t` validates the embedded archive. See [FORMAT.md](FORMAT.md) for the layout and [PERFORMANCE.md](PERFORMANCE.md) for budgets.

## Permissions

| Permission | Call sites |
| --- | --- |
| `activeTab` | Capture injection target; same-origin resource fetches ride on the tab grant, so no host permissions are needed. |
| `scripting` | `executeScript` runs `inject/capture.js` in the tab and invokes its entry point. |
| `downloads` | `downloads.download` saves the finished archive with uniquify on collision. |

There is no settings UI, popup, options page, background auto-save, telemetry, or cloud upload. Anything the capture cannot reach is listed in the archive banner and `metadata.json`, never silently dropped.

## Limits

- Archives download through a blob object URL, so only available memory bounds their size; each fetched resource is still capped at 5 MB.
- Cross-origin subresources the page grant cannot read stay unresolved.
- Closed shadow roots are invisible to page scripts and are kept as plain elements.
- See [UPSTREAM.md](UPSTREAM.md) for provenance and [ARCHITECTURE.md](ARCHITECTURE.md) for the pipeline.
