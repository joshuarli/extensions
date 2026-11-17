# Context crash recovery

DSLP-7: a successful fetch used to write `context_pages.status = 'ok'` before
saving any ancestors. An owned child using the real SQLite store and conversation
fixture was killed at its first `saveContextPage`; reopening and resuming then
stored zero ancestors. The focused regression on the original source exited 1:
the recovery expected two posts but got zero, and a legacy ok gap expected one
fetch but got zero. No live X data was used.

Completion is now written after the page's ancestor saves and queue update.
Each ancestor retains its own transaction. A crash before completion permits
another fetch; persisted context records contribute missing parents to the next
queue. The additive `context_pages.completion_valid` integer defaults to zero;
only the new successful completion writer sets it to one. Legacy ok rows are
unverified and fetched again only when queued and under the existing attempt
budget. A successful gap is then cached. Failed statuses and attempts remain
visible; successful completion resets attempts as before. Schema version 1 is
unchanged, and the new migration runs after version validation. Existing readers
still see the old columns; the `contextPageStatus` method now returns null for
unverified ok rows. Existing writers predating this change cannot establish the
new validity contract. The change does not alter the main-post or state tables.

The tests exercise an actual SIGKILL before the first save and before the second
save, reopening the DB each time. They cover a legacy false ok, a legitimate gap
that is retried once, exhausted failures, pre-attempts migration and rejection of
an unsupported schema before adding the new column. They do not exercise live X,
concurrent collectors, or power-loss guarantees.

From the repository root with Node 26 and pnpm 11, set `TMPDIR=$PWD/.work/tmp`,
`CARGO_BUILD_JOBS=1`, `RUST_TEST_THREADS=1`, and `RUSTC_WRAPPER=kache`:

```sh
cpu-guard --cores 1 -- pnpm exec vitest run x-archive-cli/test/context.test.ts x-archive-cli/test/profile-db.test.ts --maxWorkers=1
cpu-guard --cores 1 -- make lint
cpu-guard --cores 1 -- make test TEST_ARGS=--maxWorkers=1
```

For the bounded Stryker proof, use Stryker 10.1.1 and its Vitest runner in the
campaign's existing read-only fs-tools environment. Acquire the shared atomic
mutation lock before running, release only the lock acquired, and do not build
in this tree while it is held. The scratch configuration was:

```json
{
  "mutate": ["x-archive-cli/src/context.ts:124:1-125:1", "x-archive-cli/src/context.ts:185:1-186:1", "x-archive-cli/src/profile-db.ts:73:1-75:1", "x-archive-cli/src/profile-db.ts:183:1-209:1"],
  "testRunner": "vitest",
  "plugins": ["/Users/josh/repos/extensions/.work/wt/fs/.work/tmp/fs-tools/node_modules/@stryker-mutator/vitest-runner/dist/src/index.js"],
  "vitest": {"configFile": "vitest.config.ts", "related": false},
  "testFiles": ["x-archive-cli/test/context.test.ts", "x-archive-cli/test/profile-db.test.ts"],
  "coverageAnalysis": "perTest", "concurrency": 1,
  "timeoutMS": 10000, "timeoutFactor": 1.5,
  "reporters": ["clear-text", "json"],
  "jsonReporter": {"fileName": ".work/tmp/context-mutation.json"},
  "tempDirName": ".work/tmp/context-stryker-tmp"
}
```

Run `cpu-guard --cores 1 -- timeout -k 5 1200 ../fs/.work/tmp/fs-tools/node_modules/.bin/stryker run .work/tmp/context-stryker.json`.
The final dry run selected 14 tests; all 40 selected mutants were killed,
without survivors, uncovered mutants, timeouts or errors. This bounded selection
is not a mutation qualification of either whole file. Stryker warned that its
optional type-check disabling preprocessor could not parse the HTML fixture;
the dry run and tests passed. The process-kill behavior is established by the
separate original-source red and candidate regression, not by mutation alone.

The clean base suite passed 237 tests in 32 files, and the candidate passed 243
in 32 files. For each, `perf-gate-ready`, `/usr/bin/time -p cpu-guard --cores 1 --
make test TEST_ARGS=--maxWorkers=1`, and immediate `perf-gate-ready -1` exited
0/0/0 with the environment above. The observed base/candidate wall times were
53.42/50.62 seconds; these suite costs are not a speedup claim. No dedicated
context-sync performance workload is defined, and these runs do not measure a
live network fetch.
