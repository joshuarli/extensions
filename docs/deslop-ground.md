# Ground verification

Ground is locally qualified at source `2b3ebe163ddbb6cd57d2fa78a2cca50b880d2806`.
No runtime, dependency or workflow files changed in this slice.

## Commands and costs

Native macOS arm64, Node 26.12.0, pnpm 11.0.2, Vitest 5.0.5. Install the
locked dependencies in a fresh isolated checkout with lifecycle scripts disabled:

```sh
export TMPDIR=$PWD/.work/tmp CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1
cpu-guard --cores 1 -- pnpm install --frozen-lockfile --ignore-scripts
```

The install exited 0 without changing the lockfile. For each measurement,
run `perf-gate-ready` immediately before the command and `perf-gate-ready -1`
immediately afterward. All three pre/command/post triples exited 0.

| Command | Wall seconds | User CPU | System CPU |
| --- | ---: | ---: | ---: |
| First `make test TEST_ARGS=--maxWorkers=1` | 50.49 | 7.16 | 3.30 |
| Warm `make test TEST_ARGS=--maxWorkers=1` | 48.34 | 6.67 | 2.97 |
| `make lint` | 1.17 | 0.48 | 0.22 |

Each command ran under `/usr/bin/time -p cpu-guard --cores 1 --` with the
same environment. Both test runs passed typecheck and all 226 tests in 32
files. First means the first test invocation in the fresh checkout after
installation, not an empty operating-system or package cache. Vitest spawned
one isolated worker per file, with at most one running concurrently. These
costs describe that bounded setting, not CI's default worker concurrency.
`make lint` runs the existing typechecker, not a separate lint tool.

## Workflow and boundaries

Current main's CI passed at `2b3ebe1` with Node 22. The workflow and Makefile
are byte-identical to the accepted Ground entry-point change in PR6. The
current shared `gha-test-workflow` rule also returns an empty findings list
for this checkout. No workflow repair was needed.

`AGENTS.md` maps the public boundaries to their owning tests. Vitest excludes
`*.browser.test.ts` and Playwright `*.spec.ts`; neither browser suite ran here.
The CLI argument/exit process boundary, complete X export flow and live X or
YouTube endpoints remain unqualified. Those gaps belong to the later Tests
step. The existing Onefile save workload was not measured because these
changes do not touch its runtime path.

Onefile's `UPSTREAM.md` records its references and says no upstream code is
vendored. X Bookmarks documents its independent reduced implementation and
retained upstream license. This slice does not expand the provenance audit.
