# Ground verification

Base: `36f448cc40b3f0bb32d0bd4dd746c8b9b98b24f0`. This is a partial Ground result; DSLP-1 remains open.

## Local correctness proof

Commands ran from the worktree with Node 26.12.0 and pnpm 11.0.2. `.work/tmp` was created for scratch and is ignored.

- `TMPDIR="$PWD/.work/tmp" CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- pnpm install --frozen-lockfile --ignore-scripts` — exit 0; lockfile up to date, 60 packages reused.
- `TMPDIR="$PWD/.work/tmp" CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- make test TEST_ARGS=--maxWorkers=1` — exit 0; typecheck passed, 29 test files and 213 tests passed. Vitest ran at most one worker concurrently.
- `TMPDIR="$PWD/.work/tmp" CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- make lint` — exit 0; typecheck passed. This is not a separate lint tool.

`make test` retains both commands from `pnpm run check`: typecheck and the same Vitest suite. CI now invokes it; CI has not run this change. `vitest.config.ts` excludes `*.browser.test.ts` and does not include Playwright `*.spec.ts`; neither browser suite was run here. No test was removed.

## Remaining gates and boundaries

- Cold and warm `make test` and `make lint` costs are unmeasured. Perf gate deferred: host busy; the supplied host assessment reported `perf-gate-ready -s` exit 75. No timing, benchmark, coverage, or Stryker run was performed in this lane.
- CI must pass and the `gha-test-workflow` check must be established clean for the changed workflow. The timing acceptance remains open even if CI passes.
- The CLI's argument and exit-code process boundary, complete X export flow, and live X and YouTube endpoints have no end-to-end test; helper and fixture coverage is mapped in `AGENTS.md`. Browser and extension runtime behavior was not verified here.
- Onefile has an existing save workload and budgets in [PERFORMANCE.md](../extension-onefile/PERFORMANCE.md); this static tooling change does not alter the capture path. Its current performance gate was not measured.
- [Onefile upstream ground truth](../extension-onefile/UPSTREAM.md) lists upstream revisions and says no upstream code is vendored. [X Bookmarks](../extension-x-bookmarks/README.md) describes an independent reduced implementation inspired by xarchive, with its upstream license retained. No other vendored tree was identified by the tracked path inventory; this is not a full provenance audit.
