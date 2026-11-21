# Performance

Measure the product the same way every time, and gate only the egregious regressions named below. Run all measurements on production builds (`pnpm run dist`) unless you state otherwise.

## Measure the build

1. Run `pnpm run build` and record the wall time.
2. Record `dist/extension-suite/service-worker.js`, `dist/extension-suite/inject/onefile/capture.js`, and `dist/extension-suite/inject/onefile/loader.js` in bytes.
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

## Validation 2026-10-27

Five alternating runs per side per fixture, production `dist` capture bundle against upstream `single-file-core` 1.7.1 defaults in the same Chromium, medians with min-max spread. The polyglot build step ran from the same unminified sources; the download step is excluded as environment-bound. Load averaged 4.6 on 18 cores with sides interleaved.

| Fixture | Onefile median (spread) | Upstream median (spread) | Onefile bytes | Upstream bytes |
| --- | --- | --- | --- | --- |
| small | 2 ms (2-3) | 27 ms (26-28) | 5702 | 349 |
| article | 3 ms (3-5) | 28 ms (28-31) | 50200 | 42941 |
| image-heavy | 7 ms (6-8) | 30 ms (30-31) | 10735 | 2765 |
| css-heavy | 6 ms (5-6) | 29 ms (28-29) | 7651 | 1181 |

Onefile component medians: capture 1-3 ms, resource fetch 1-3 ms, archive build 0-1 ms. No run errored; our unresolved counts were 2 and 1 on image-heavy and css-heavy by policy (dropped media, unreachable cross-origin stylesheet), zero elsewhere. Upstream outputs verified by marker and embedded data URLs.

Verdict: no egregious signal, so no source changes. The time gap reflects policy, not tuning: upstream base64-embeds every resource while this format stores binaries and references them. The size gap on tiny fixtures reflects the fixed viewer and ZIP overhead (about 5 KB) against 73-byte fixture images; it reverses on real media where base64 costs a third. Heap deltas read identically zero in this environment, so peak memory stays omitted as unreliable.

Production bundles on 2026-10-27: `service-worker.js` 96 KB, `inject/capture.js` 8 KB, `inject/loader.js` 5 KB. `pnpm run check` passes typecheck plus 106 unit tests in about 1.3 seconds.

After the suite merge on 2026-11-02, Onefile shares the suite worker and lives under `dist/extension-suite/`: suite worker 132.85 KB, `inject/onefile/capture.js` 8.09 KB, `inject/onefile/loader.js` 4.78 KB. The capture and loader bundles stay within 10 percent of their prior sizes; the worker now also contains the other three features, so its size is not comparable to the former Onefile-only worker. `pnpm run check` passes typecheck plus 125 unit tests.

## Benchmark entrypoint

`scripts/bench.mjs` is the single entrypoint. `make bench-list` prints the
registry; `make bench BENCH_ARGS='...'` passes selectors through.

| Tier | Workloads | Requirements | Cost |
| --- | --- | --- | --- |
| edit | runner selection, dry run, exclusions, paired budget math | none | seconds |
| change | `onefile/{small,article,image-heavy,css-heavy}`, `onefile-cli/onefile-assemble`, `x-archive/x-export`, `extension/extension-startup` | production bundles, pinned fixtures, Chromium for browser workloads | one round per workload, seconds to minutes |
| scenario | `onefile/upstream-compare` | pinned upstream comparator plus Change requirements | tens of minutes |
| full | everything, including sustained and matrix work | manual request only | not runnable by a flag |

Each workload records its purpose in `--list`. `--tier`, `--workload`, `--area`
and repeated `--skip` select workloads; an unknown name, area, flag or an empty
selection exits 2. `--dry-run` prints commands and writes nothing. `--check`
runs preflight only. Results land in a dated `.work/tmp/bench-<timestamp>/`
directory with a `summary.json`, per-workload logs, samples and attribution.

Preflight runs before anything executes: production bundles exist and are not
older than their sources, fixtures are present, Chromium is installed, disk has
at least 2 GiB free, and `perf-gate-ready -1` reports host readiness. A missing
requirement names the fix and the affected workloads and nothing runs. A busy
host still runs the selection; the summary marks timing validity as
"busy host: ratios only", so only paired ratios and work counters decide claims.

Run a single Change workload with `make bench BENCH_ARGS='--workload=x-export'`.
`onefile-assemble` builds 64 archives from the article fixture and verifies the
marker and directory entries; `x-export` parses the conversation fixture,
exports 500 records, re-reads them and verifies record identity.
`extension-startup` installs the built suite in a fresh Chromium profile five
times and verifies that the service worker started. Browser onefile workloads
keep the alternating onefile-only path. Process-tree CPU time and peak RSS are
sampled for Node workloads and written beside their samples.

## Budgets

`--budget=BASE,CAND` compares two result JSON files without running workloads.
It uses the median of per-pair CPU time per unit of work, requires at least five
usable pairs, and calls a regression only when the ratio exceeds both 10% and
the observed spread. It exits 1 on `regression`, 0 on `within` or
`inconclusive`. Without paired results a completion is not a performance verdict.

The upstream comparator is pinned in `scripts/bench-comparator.json`
(`single-file-core@1.7.1`), provisioned under `.work/tmp/upstream-base` as before.
It is not a project dependency; the scenario preflight checks its version and
excludes the comparison when absent. Set `BENCH_COMPARATOR_FILE` to validate an
alternate pin. Full remains manual only.

## Validation 2026-11-21

`make bench BENCH_ARGS='--tier=edit'` and `vitest run scripts/bench.test.ts` pass:
selection, unknown selectors, all-skipped rejection, dry-run with no writes,
preflight failure with an unmet comparator pin, and paired budget math.

One Change workload of each harness kind ran end to end: `x-export` (5 samples,
500 records and 373,162 bytes per export, 0.13 s tree CPU, 117 MiB peak RSS),
`onefile/small` (5 samples, 5,702 bytes each, 2-3 ms per save, no fixture marker
or archive errors) and `extension/extension-startup` (5 installed worker starts
in fresh profiles, 297-406 ms each, 0.92 s tree CPU, ~996 MiB peak RSS for the
sampled browser tree). These summaries record completion, not a verdict. Gate
checks around the runs alternated between quiet and busy because of a co-located
VM, so absolute timings from that session stay observations; work counters and
the correctness oracles are host independent. A paired `x-export` budget check on
two later runs returned `within` (ratio 1, spread 0, 5 pairs). Scenario and Full
were not run.
