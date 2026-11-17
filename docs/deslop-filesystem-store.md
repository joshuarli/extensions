# Filesystem archive-store test slice

At base `f75b7641f03e5e6ccfe7f5eafc6c6a81656d64cf`, the Node component boundary is `FsBookmarksStore` and `FsLikesStore` against real files. Collection constructs them in `x-archive-cli/src/run.ts:206,250`. `state.ts:28-35` turns missing, read and JSON parse errors into null; `fs-store.ts:17-20` turns null and non-arrays into empty records. Both saves read, merge, and replace the file (`fs-store.ts:41-52,96-107`). `readJsonFile` also serves scan state and credential/binding caches (`deps.ts:33,185`); a fix must preserve their separate semantics. Missing record files must still initialize empty, valid records must merge, and accounts remain isolated.

## Test audit and reproduction

The existing four Node tests exercise a missing bookmarks profile, a same-ID available/unavailable merge, likes scan state, and a JSON helper round trip. The store tests are component tests: actual filesystem, no network or fake read helper. Their literal assertions catch missing writes and the available-record merge, but do not test archive read errors, corrupt shapes, account isolation, or likes record saves. Fixtures use `X_ARCHIVE_STATE` under `TMPDIR` and teardown removes the unique directory. They share a process environment, so the focused run uses one worker. There is no CLI process, browser, live service, or credential test here. The broader Node suite is a separate tier; no Full mutation or whole-suite baseline was run.

The added table covers each store with schema-decoded valid old `100` and incoming `200` posts. A control initializes a missing profile, merges both posts, and verifies account `456` is independent. For corrupt archives it first creates the directory via a valid save, then replaces the archive with the literal UTF-8 bytes `[{"tweet_id":"old"` or `{"tweet_id":"old"}\n`. A save must reject and preserve those exact bytes. For permissions it saves old, records the exact bytes, chmods the file to `0200`, verifies `readFileSync` throws `EACCES`, attempts the new save, and restores `0600` in `finally` before comparing bytes. A privileged process that can read the file fails the EACCES precondition rather than reporting a meaningful pass. The current source fulfills each save and replaces bytes with an array containing `200`; all six regressions are intentionally red. The current broken behavior itself is the fault injection, so no runtime edit was made.

## Baseline and tools

- Node 26.12.0, pnpm 11.0.2, Vitest and coverage-v8 5.0.5. Initial `TMPDIR="$PWD/.work/tmp" pnpm exec vitest run x-archive-cli/test/fs-store.test.ts --maxWorkers=1`: exit 0, four tests. `TMPDIR="$PWD/.work/tmp" make lint`: exit 0. The first pnpm invocations unexpectedly auto-populated ignored worktree `node_modules` from the lockfile; no tracked dependency files changed.
- `TMPDIR="$PWD/.work/tmp" cpu-guard --cores 2 -- pnpm exec vitest run x-archive-cli/test/fs-store.test.ts --maxWorkers=1 --coverage --coverage.include=x-archive-cli/src/state.ts --coverage.include=x-archive-cli/src/fs-store.ts --coverage.reporter=text --coverage.reporter=json --coverage.reportsDirectory=.work/tmp/fs-coverage`: exit 0, 4 tests; 36/64 lines, 7/18 branches. `fs-store.ts`: 55.55% lines, 37.5% branches; `state.ts`: 57.89% lines, 40% branches. Included files cover unimported decisions too; uncovered lines are fs-store 56–75, 97–107, 125 and state 19–25, 33, 45–48. These are investigation leads, not coverage passes.
- Scratch-only installation: `pnpm --dir .work/tmp/fs-tools add --ignore-scripts --save-exact --registry=https://npm.17166969.xyz/current @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1 typescript@6.0.3` exited 0. The runner declares Vitest >=2; its implementation loads the project Vitest and config and accepts explicit `testFiles`. Its package exports `dist/src/index.js`.
- Scenario config: mutate `x-archive-cli/src/state.ts` and `x-archive-cli/src/fs-store.ts`; plugin `./.work/tmp/fs-tools/node_modules/@stryker-mutator/vitest-runner/dist/src/index.js`; runner `vitest`, `vitest.config.ts`, `related: false`, `testFiles: ["x-archive-cli/test/fs-store.test.ts"]`, per-test coverage, concurrency 1, timeoutMS 10000, timeoutFactor 1.5, reporters clear-text/progress/json, JSON `.work/tmp/fs-mutation.json`, sandbox `.work/tmp/fs-stryker-tmp`. Under the atomic shared `mkdir /Users/josh/d/stuff/.work/tmp/mutation.lock` lock, released by trap: `TMPDIR="$PWD/.work/tmp" cpu-guard --cores 2 -- timeout 1200 .work/tmp/fs-tools/node_modules/.bin/stryker run .work/tmp/fs-stryker.json` exited 0, 95 mutants in 7 seconds, dry run exactly 4 tests. Raw elapsed time is diagnostic, not a performance claim. JSON captured all identities and statuses listed below. 37 killed, 13 survived, 45 no coverage, zero timeout/errors. Survivors and uncovered mutants remain leads; this is not Tests qualification.
- First setup used a plugin directory rather than its exported file; Node rejected directory import and the run exited 1 before tests. The one changed setup retry used the exported file. An empty-test-filter negative control warned that the filter matched no files and fell back to broader discovery; it was terminated (143), so it does not validate empty-selection rejection. The real Scenario reported exactly four focused tests. As a runner/oracle control, fs-store mutant 13 removed the existing-record loop and was killed by the literal `available` versus `unavailable` assertion; mutant 3 removed the write and was killed by the expected record count. These are mutation controls, not a qualified selector gate.
- After edits, the same focused Vitest command exits 1: 6 failed, 6 passed; every failed case reports fulfilled rather than rejected and changed bytes. `TMPDIR="$PWD/.work/tmp" make lint` exits 0. No mutation was run on the red baseline.

The parent must implement and verify the runtime fix separately. Failure propagation, actionable errors, cache compatibility, folders, crash/concurrent write atomicity, CLI, browser and live endpoints remain unverified; this slice closes neither DSLP-8 nor the Tests step.

## Baseline mutant inventory

Each row gives file, ID, start line and column, operator, replacement, and result as emitted by Stryker. IDs and classes refer to the base above; surviving and uncovered rows are unresolved, not accepted risks or equivalence claims.

| File | ID | Position | Operator | Replacement | Result |
| --- | ---: | --- | --- | --- | --- |
| fs-store.ts | 19 | 55:90 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 20 | 57:57 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 21 | 58:11 | ConditionalExpression | `true` | NoCoverage |
| fs-store.ts | 22 | 58:11 | ConditionalExpression | `false` | NoCoverage |
| fs-store.ts | 23 | 58:11 | EqualityOperator | `typeof (record as {\n  id?: unknown;\n}).id !== "string"` | NoCoverage |
| fs-store.ts | 24 | 58:54 | StringLiteral | `""` | NoCoverage |
| fs-store.ts | 25 | 58:64 | CallExpression | `;` | NoCoverage |
| fs-store.ts | 26 | 60:35 | CallExpression | `;` | NoCoverage |
| fs-store.ts | 28 | 61:37 | ArrayDeclaration | `[]` | NoCoverage |
| fs-store.ts | 29 | 64:48 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 30 | 65:49 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 31 | 66:11 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 32 | 68:15 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 33 | 74:52 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 34 | 75:5 | CallExpression | `;` | NoCoverage |
| fs-store.ts | 40 | 96:52 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 41 | 97:9 | ConditionalExpression | `true` | NoCoverage |
| fs-store.ts | 42 | 97:9 | ConditionalExpression | `false` | NoCoverage |
| fs-store.ts | 43 | 97:9 | EqualityOperator | `items.length !== 0` | NoCoverage |
| fs-store.ts | 44 | 100:35 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 45 | 102:7 | CallExpression | `;` | NoCoverage |
| fs-store.ts | 46 | 104:31 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 47 | 105:7 | CallExpression | `;` | NoCoverage |
| fs-store.ts | 49 | 107:34 | ArrayDeclaration | `[]` | NoCoverage |
| fs-store.ts | 56 | 124:42 | BlockStatement | `{}` | NoCoverage |
| fs-store.ts | 0 | 17:47 | BlockStatement | `{}` | Killed |
| fs-store.ts | 1 | 19:41 | ArrayDeclaration | `["Stryker was here"]` | Killed |
| fs-store.ts | 2 | 22:63 | BlockStatement | `{}` | Killed |
| fs-store.ts | 3 | 23:3 | CallExpression | `;` | Killed |
| fs-store.ts | 4 | 26:85 | BlockStatement | `{}` | Killed |
| fs-store.ts | 5 | 35:31 | BlockStatement | `{}` | Killed |
| fs-store.ts | 6 | 36:45 | StringLiteral | `""` | Survived |
| fs-store.ts | 7 | 37:45 | StringLiteral | `""` | Survived |
| fs-store.ts | 8 | 38:47 | StringLiteral | `""` | Survived |
| fs-store.ts | 9 | 41:71 | BlockStatement | `{}` | Killed |
| fs-store.ts | 10 | 42:9 | ConditionalExpression | `true` | Killed |
| fs-store.ts | 11 | 42:9 | ConditionalExpression | `false` | Survived |
| fs-store.ts | 12 | 42:9 | EqualityOperator | `items.length !== 0` | Killed |
| fs-store.ts | 13 | 45:35 | BlockStatement | `{}` | Killed |
| fs-store.ts | 14 | 47:7 | CallExpression | `;` | Killed |
| fs-store.ts | 15 | 49:31 | BlockStatement | `{}` | Killed |
| fs-store.ts | 16 | 50:7 | CallExpression | `;` | Killed |
| fs-store.ts | 18 | 52:34 | ArrayDeclaration | `[]` | Killed |
| fs-store.ts | 35 | 78:42 | BlockStatement | `{}` | Killed |
| fs-store.ts | 36 | 82:42 | BlockStatement | `{}` | Killed |
| fs-store.ts | 37 | 91:31 | BlockStatement | `{}` | Killed |
| fs-store.ts | 38 | 92:45 | StringLiteral | `""` | Survived |
| fs-store.ts | 39 | 93:45 | StringLiteral | `""` | Survived |
| fs-store.ts | 50 | 110:53 | BlockStatement | `{}` | Killed |
| fs-store.ts | 51 | 111:49 | BlockStatement | `{}` | Killed |
| fs-store.ts | 52 | 112:11 | BlockStatement | `{}` | Killed |
| fs-store.ts | 53 | 114:15 | BlockStatement | `{}` | Killed |
| fs-store.ts | 54 | 120:57 | BlockStatement | `{}` | Killed |
| fs-store.ts | 55 | 121:5 | CallExpression | `;` | Killed |
| state.ts | 61 | 6:62 | StringLiteral | `""` | NoCoverage |
| state.ts | 62 | 6:99 | StringLiteral | `""` | NoCoverage |
| state.ts | 63 | 6:109 | StringLiteral | `""` | NoCoverage |
| state.ts | 69 | 18:48 | BlockStatement | `{}` | NoCoverage |
| state.ts | 70 | 19:28 | StringLiteral | `""` | NoCoverage |
| state.ts | 71 | 22:41 | BlockStatement | `{}` | NoCoverage |
| state.ts | 72 | 23:7 | ConditionalExpression | `true` | NoCoverage |
| state.ts | 73 | 23:7 | ConditionalExpression | `false` | NoCoverage |
| state.ts | 74 | 23:19 | StringLiteral | `""` | NoCoverage |
| state.ts | 75 | 23:62 | StringLiteral | `""` | NoCoverage |
| state.ts | 76 | 24:16 | LogicalOperator | `process.env["XDG_DATA_HOME"] && join(homedir(), ".local", "share")` | NoCoverage |
| state.ts | 77 | 24:28 | StringLiteral | `""` | NoCoverage |
| state.ts | 78 | 24:64 | StringLiteral | `""` | NoCoverage |
| state.ts | 79 | 24:74 | StringLiteral | `""` | NoCoverage |
| state.ts | 80 | 25:21 | StringLiteral | `""` | NoCoverage |
| state.ts | 81 | 25:26 | StringLiteral | `""` | NoCoverage |
| state.ts | 87 | 32:11 | BlockStatement | `{}` | NoCoverage |
| state.ts | 97 | 44:58 | BlockStatement | `{}` | NoCoverage |
| state.ts | 98 | 45:7 | BlockStatement | `{}` | NoCoverage |
| state.ts | 99 | 47:11 | BlockStatement | `{}` | NoCoverage |
| state.ts | 57 | 5:37 | BlockStatement | `{}` | Killed |
| state.ts | 58 | 6:16 | LogicalOperator | `(process.env["X_ARCHIVE_STATE"] ?? process.env["XDG_STATE_HOME"]) && join(homedir(), ".local", "state")` | Killed |
| state.ts | 59 | 6:16 | LogicalOperator | `process.env["X_ARCHIVE_STATE"] && process.env["XDG_STATE_HOME"]` | Killed |
| state.ts | 60 | 6:28 | StringLiteral | `""` | Killed |
| state.ts | 64 | 7:21 | StringLiteral | `""` | Survived |
| state.ts | 65 | 10:57 | BlockStatement | `{}` | Killed |
| state.ts | 66 | 11:28 | StringLiteral | `""` | Survived |
| state.ts | 67 | 14:57 | BlockStatement | `{}` | Killed |
| state.ts | 68 | 15:28 | StringLiteral | `""` | Survived |
| state.ts | 82 | 28:53 | BlockStatement | `{}` | Killed |
| state.ts | 83 | 29:7 | BooleanLiteral | `existsSync(path)` | Killed |
| state.ts | 84 | 29:7 | ConditionalExpression | `true` | Killed |
| state.ts | 85 | 29:7 | ConditionalExpression | `false` | Survived |
| state.ts | 86 | 30:7 | BlockStatement | `{}` | Killed |
| state.ts | 88 | 37:89 | BlockStatement | `{}` | Killed |
| state.ts | 90 | 38:28 | ObjectLiteral | `{}` | Killed |
| state.ts | 91 | 38:41 | BooleanLiteral | `false` | Killed |
| state.ts | 92 | 39:28 | StringLiteral | `""` | Survived |
| state.ts | 94 | 40:61 | StringLiteral | `""` | Survived |
| state.ts | 95 | 40:67 | ObjectLiteral | `{}` | Survived |
| state.ts | 96 | 41:3 | CallExpression | `;` | Killed |
