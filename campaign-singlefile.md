# SingleFile fork: one-click universal self-extracting ZIP in `extension-onefile`

## Status

- Goal: third MV3 extension (`extension-onefile`) that saves the current tab as a universal self-extracting ZIP/HTML polyglot (`.u.zip.html`), offline-openable via `file://`.
- Baseline (2026-10-27): `pnpm run typecheck` ~0.5s green; `pnpm run test` 59/59 green ~1.2s; tree has two extensions (AGENTS.md already anticipates three).
- Accepted: none. Red: none. Parked: none.
- Next: OF-01. Resume: run `pnpm run check`, then start OF-01.
- Steering: parent steering checkpoint runs after each accepted slice.

## Charter

- Decide and keep going. Record a decision only when a later slice depends on it.
- Within this doc's grant, proceed without waiting. Park an item that needs authority outside the grant.
- Hard stops are few: irreversible/outside-repo actions, doc-forbidden actions, or a loop that cannot check anything. Pushing is always forbidden.
- Fix egregious problems met on the way in their own commit: capture-path copies beyond 2x archive bytes, archive over 20% larger than upstream same-policy output without a fidelity reason, or median save over 2x upstream on the same fixture. Record anything else and leave it.
- Parity before optimization. Product-performance budgets are measured and logged, gating only the egregious thresholds above.
- One writer by default. Only OF-03 (fixtures) and OF-06 (docs) may run parallel after OF-02 lands; disjoint files only, worktrees at `.work/wt/<lane>`, following the orchestrate worktree lifecycle.
- A failing item gets at most 3 attempts with a stated cause before retry (reproduce minimal, one hypothesis at a time); then park it on `park/<id>-<short>` with cause and retry condition.
- Every commit is Conventional Commits with scope `onefile`; the item ID goes in the body. Code comments never cite this doc.

## Decisions

- [owner 2026-10-27] Location is `extension-onefile/`; existing extensions stay untouched behaviorally.
- [owner 2026-10-27] Exactly one job: toolbar click saves the active tab as universal self-extracting ZIP only. No format choice, settings, popup, confirmation, or background auto-save.
- [owner 2026-10-27] Derivative stays AGPL-compatible: preserve upstream notices/attribution, record SHAs and provenance in `UPSTREAM.md`.
- [prescribed] Toolchain is the repo's: pnpm, Vite/rolldown bundles, `tsrs --noEmit`, Effect 4 for I/O, Schema at boundaries. The draft's npm/esbuild/`tsc` commands are superseded by `pnpm run check`, `pnpm run build`, `pnpm run dist`.
- [prescribed] Fixed capture policy lives in one small typed module; no preference system, profiles, sync, migrations, or feature flags survive.
- [prescribed] Binary resources stay binary ZIP entries, never base64 data URIs. Small internal encoding to repair the polyglot ZIP itself is the only exception.
- [prescribed] Bundle formats follow the repo invariant: service worker as ES module, page-injected scripts as classic bundles.
- [prescribed] Optimizers go, rewriting stays: HTML/CSS minification, unused-CSS/font pruning, and lossy passes are deleted; `url(...)` rewriting, encoding/escaping, namespaces, and shadow-DOM serialization stay.
- [prescribed] Executor may add a pinned Playwright dev dependency plus a `test:browser` script for `extension-onefile` only; it must not rewire existing suites and must stay within build-time and bundle-size budgets logged in PERFORMANCE.md.
- [delegated] Exact policy-module shape and message protocol, within strict TS plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- [delegated] Whether an offscreen document is needed, bound: only if the proven ZIP/blob path requires it; never by habit.
- [delegated] Filename sanitizer edge cases, bound: example `Page Title (2026-10-27 15-30-00).u.zip.html`, Chromium uniquify on collision, never lose the normal download destination.
- [delegated] Retry/backoff bounds for capture-fetch and MV3 suspension recovery, bound: same-tab clicks never overlap; cross-tab results never mix; partial files never masquerade as success.

## Baseline

- Green: typecheck ~0.5s; unit tests 59/59 ~1.2s (2026-10-27, commit `cd799b0`).
- `pnpm run test:browser` is documented in AGENTS.md but has no script; `.browser.test.ts` files exist and are excluded from vitest. OF-02 wires the runner for `extension-onefile` only.
- No `.github/` workflows exist; the one minimal workflow in OF-06 is explicitly requested, not drive-by CI.
- `build/` and `dist/` are generated; executor times the first build and reports it.

## Sequence

- OF-01 ground truth and scaffold. Owns `extension-onefile/src/manifest.json`, `extension-onefile/src/service-worker.ts` (skeleton), `vite.config.ts` (additive entry only), `UPSTREAM.md` (SHA pins). Prereqs: none. Acceptance: SHAs recorded; `pnpm run check && pnpm run build` green with the new entry.
- OF-02 minimal product. Owns `extension-onefile/src/**` (orchestration, capture boundary, ZIP builder, download coordinator, badge/error states), `extension-onefile/test/**` (first e2e). Prereqs: OF-01. Acceptance: click saves a trivial page to `.u.zip.html` via `downloads` with correct name; `chrome://` pages fail loudly with an action-state error; `pnpm run vitest run extension-onefile` green.
- OF-03 parity corpus. Owns `extension-onefile/test/**` (fixtures, goldens from the pinned reference). Prereqs: OF-01 (SHAs), OF-02 (pipeline). Acceptance: `pnpm run vitest run extension-onefile` green over unicode, mixed-MIME images, CSS `url()`/nested refs, external stylesheets, fonts, picture/srcset, lazy images, open/closed shadow DOM, adopted stylesheets, same/cross-origin frames, SVG, canvas, ZIP-delimiter byte sequences, unusual filenames, binary integrity.
- OF-04 hardening. Owns `extension-onefile/src/**`. Prereqs: OF-03. Acceptance: large/deep DOM, CSS-heavy pages, ZIP64-boundary archives, MV3 suspension recovery, and offline `file://` open with no external requests and page scripts disabled all verified (browser-dependent proofs use Needs-environment commands where the runner lacks Chromium).
- OF-05 simplification. Owns `extension-onefile/src/**` (deletions, TS migration in dependency order: orchestration first, retained capture modules next, adapter last). Prereqs: OF-04. Acceptance: no settings/profile/migration/sync code, no optimizer passes, no unsupported-format branches; no minifier modules in the bundle; typecheck plus full corpus green.
- OF-06 docs, permissions, CI. Owns `extension-onefile/README.md`, `ARCHITECTURE.md`, `UPSTREAM.md`, `FORMAT.md`, `PERFORMANCE.md` (methodology), manifest, one `.github/workflows/onefile.yml`. Prereqs: OF-02. Acceptance: docs focused; permissions minimal and justified per call site; links check clean.
- OF-07 optimization and validation. Owns `extension-onefile/src/**` (measured changes only). Prereqs: OF-05. Acceptance: PERFORMANCE.md reports sizes, durations, archive sizes, and peak memory where reliable across small/article/image-heavy/CSS-heavy pages versus upstream same-policy baseline (5 alternating runs per side, median plus spread, production builds); no functional regression.
- OF-08 close. Owns dead code, review findings, final report. Prereqs: all above. Acceptance: `pnpm run check`, full tests, `pnpm run dist`; dead-code sweep done; review P1/P2 findings fixed; final report committed (architecture, removed/retained features, test results, perf comparison, LOC/bundle deltas, limits, commits, ZIP risks).

## Acceptance

- Build/load: `pnpm run build` emits `extension-onefile` loadable via `chrome://extensions` unpacked; `pnpm run dist` emits the production artifact.
- One click: toolbar action captures, builds the universal archive, triggers the download, and clears the badge; failure sets an actionable action state and logs diagnostics.
- Format: every output opens offline under `file://` in clean Chromium without the extension; `unzip -t` passes; entries carry valid offsets, CRC32, names, MIME types; no captured image/font becomes base64.
- Isolation: no external requests during extraction; original page scripts stay disabled; safe archive CSP preserved; source URL and capture timestamp stored as metadata.
- Fidelity: OF-03/OF-04 corpus green, including shadow DOM, adopted stylesheets, frames where permissions allow, canvas where possible, and lazy images with bounded reversible behavior; no audio/video full-download by default.
- No settings UI, options page, profiles, migrations, or format switches remain; no unused permissions (no cloud identity, native messaging, bookmarks, side panels, declarativeNetRequest without proven need).
- Docs: README, ARCHITECTURE, UPSTREAM, FORMAT, PERFORMANCE exist and stay focused.
- Report: final commit summarizes architecture, removals, retained deps (pinned, with generation process for the ZIP extractor/vendored JS), test and perf results, and residual ZIP risks.

## Needs environment

- Clean-profile offline open with network disabled: `pnpm run test:browser -- extension-onefile` (Playwright: fresh profile, no extension, `file://` open, resource-request audit).
- ZIP integrity on large outputs: `unzip -t <output>.u.zip.html`.
- Manual load check where automation lacks Chromium: load `dist/extension-onefile` unpacked, save a page, open the file with networking disabled in a fresh profile.

## Execution boundary and non-goals

- May create/edit: `extension-onefile/**`; additive `vite.config.ts` entry; additive shared-script support; one minimal workflow file; `.work/` scratch only.
- Must not: change existing extensions' behavior; push; run pre-commit hooks; run formatters; add React/Vue/Svelte/DI frameworks; add telemetry, accounts, cloud uploads, or external services.
- Contract changes for the owner: new AGPL-covered code with notices; new permissions (`activeTab`, `scripting`, `downloads`, plus `offscreen`/host permissions only if OF-02 proves need); automatic downloads with the fixed filename scheme.
- Non-goals: Firefox/Safari, MV2, HTML-only/non-universal/ordinary-ZIP/MHTML/MAFF outputs, PNG/PDF polyglots, multi-page archives, cloud destinations, native/bookmark/share/clipboard/annotation/infobar flows, scheduled or multi-tab saves, i18n expansion, password/encryption support.

## Reference

- Build wiring: [vite.config.ts](vite.config.ts) (entries at lines 50-80, config builder at lines 85-120); [scripts/build-extensions.mjs](scripts/build-extensions.mjs) (per-extension loop at lines 39-49); [vitest.config.ts](vitest.config.ts) (browser-test exclusion at line 6); [tsconfig.json](tsconfig.json) (strict flags at lines 6-20, globs already cover `extension-*/` at lines 26-31).
- Action plus scripting pattern: [extension-allow-right-click/src/service-worker.ts](extension-allow-right-click/src/service-worker.ts) (click handling at lines 16-22, frame-targeted injection at lines 42-56); commands in [docs/development.md](docs/development.md).
- Upstream oracle (pin SHAs in OF-01): SingleFile-MV3, single-file-core (`core/index.js`, `core/helper.js`, `processors/compression/`, `processors/frame-tree/`, `processors/lazy/`, `zip-build/`, `src/core/bg/`, `src/core/content/`), SingleFile docs, SingleFileZ history, Polyglot-HTML-ZIP-PNG background, `single-file-core/test/sfz-harness/`.
