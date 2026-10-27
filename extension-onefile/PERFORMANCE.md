# Performance

Measure the product the same way every time, and gate only the egregious regressions named below. Run all measurements on production builds (`pnpm run dist`) unless you state otherwise.

## Measure the build

1. Run `pnpm run build` and record the wall time.
2. Record `dist/extension-onefile/service-worker.js`, `inject/capture.js`, and `inject/loader.js` in bytes.
3. Keep the Playwright dev dependency and the `test:browser` script inside the current build-time and bundle-size budgets: flag any change that moves either by more than 10 percent.

## Measure a save

1. Serve each fixture page over plain HTTP with no cache: `small` (one paragraph), `article` (long text), `image-heavy` (fifty images), `css-heavy` (large stylesheet plus imports).
2. Click the toolbar button five times, alternating with the upstream same-policy baseline build.
3. Record the downloaded archive bytes, the save duration from click to download event, and the peak worker memory where the browser exposes it reliably.
4. Report the median and the spread across the five runs per side.

## Gate

Fail the run only on an egregious regression, and fix it in its own commit:

- Capture-path copies beyond twice the archive bytes.
- An archive more than 20 percent larger than the upstream same-policy output without a fidelity reason.
- A median save more than twice as slow as upstream on the same fixture.

## Current snapshot

Development build on 2026-10-27: `pnpm run check` passes typecheck plus 106 unit tests in about 1.3 seconds; `pnpm run build` finishes in about 1 second. Full comparative numbers land here in OF-07.
