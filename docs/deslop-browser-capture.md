# Onefile Chromium boundary: DSLP-4 slice

At base `f541ebd820fb474a8a773473332c6c732760c700`, the archive
HTTP viewer test asserted that an image reference became a blob URL, but did
not check the blob's contents. It could pass with corrupt extracted bytes.
The test now reads the image's blob in Chromium and compares every byte with
the image placed in the archive. This protects the stored-resource-to-viewer
boundary described in `extension-onefile/FORMAT.md`, not an installed MV3
extension: capture tests inject the built classic script into ordinary pages.

## Bounded inventory

All 12 non-performance Onefile browser tests were inspected. Dispositions are
retain unless marked fix; observations describe what is actually asserted, not
complete output equivalence.

| Case | Disposition and observed boundary |
| --- | --- |
| Unicode | Retain: title, body text, no resources or script. |
| Resources | Retain: expected image URLs, media unresolved, token markers. |
| Stylesheets | Retain: nested rules, image/font references and failed stylesheet. |
| Shadow roots | Retain: open contents included, closed contents absent. |
| Frames | Retain: same-origin text and cross-origin unresolved entry. |
| Canvas | Retain: image data URL replaces canvas. |
| Adopted styles | Retain: stylesheet and resource marker. |
| Deep/wide DOM | Retain: deepest and final list markers and no page errors. |
| CSS scale | Retain: final import, adopted sheet, endpoint URLs and count. |
| Saved scripts | Retain: counter frozen in file archive, no external requests/errors. |
| HTTP archive | Fix: blob bytes as well as URL, visible text, banner and requests. |
| File archive | Retain: text, banner/source, placeholder and no external requests/errors. |

These are selective assertions; they do not prove every HTML node, token mapping,
resource type, pixel rendering, or capture-to-download workflow. Performance
specs and non-Onefile excluded browser tests are outside this slice.

## Reproduction and control

Node 26.12.0, pnpm 11.0.2, Playwright 1.64.1, cached Chromium; from the
worktree root set `TMPDIR=$PWD/.work/tmp`, `PYTHON_CPU_COUNT=2`,
`CARGO_BUILD_JOBS=1`, `RUST_TEST_THREADS=1`, `RUSTC_WRAPPER=kache`.
Use `cpu-guard --cores 2` for the commands below. The frozen scripts-disabled
install and development build passed before the existing browser baseline:
`pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run build`, and
`pnpm run test:browser --workers=1` (12 passed).

For the fault control, atomically acquire
`mkdir /Users/josh/d/stuff/.work/tmp/mutation.lock` and fail closed on failure;
back up `build/extension-suite/inject/onefile/loader.js` to `.work/tmp`,
restore it and release only the acquired lock on exit. Replace the single
`new Blob([data.buffer], { type: found?.mime` in that built file with
`new Blob([new Uint8Array(data.length).buffer], { type: found?.mime`.
Run `pnpm run test:browser --workers=1 extension-onefile/test/browser/polyglot-render.spec.ts -g 'loader upgrades images'`.
It exited 1 at the new byte assertion: expected PNG bytes, received zeros.
This fault still creates a blob URL, so the previous URL-only check cannot
distinguish it. The unmodified focused suite passed 2 tests. After restoration,
an ordinary build passed; SHA-256 capture.js
`8e82db069d8da87ee02d14a20c08d36f5e3e5dd251501fd28d75dc0b9b5f3ace`,
loader.js `c893b5ea31763844aeeb7ea8de9e93ec2a49a02b9164ce74c0d37216e46db2c9`.
This is one hand fault, not a mutation inventory or whole-change CI qualification.

After the ordinary rebuild, `make test TEST_ARGS=--maxWorkers=1` exited 0
(33 files, 253 tests), `make lint` exited 0, and
`pnpm run test:browser --workers=1` exited 0 (12 tests). These commands used
the environment and CPU bound above. The host had concurrent work, so no
before/after gate-ready timing is claimed; application runtime was unchanged.
