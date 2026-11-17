# Archive read-safety repair

Base: `f75b7641f03e5e6ccfe7f5eafc6c6a81656d64cf`, Node 26.12.0,
pnpm 11.0.2. DSLP-8 concerns the real filesystem bookmarks/likes stores:
failed reads and parse errors became `null`, then empty records, then a
successful replacement containing only newly fetched posts.

## Contract and repair

The private record reader now distinguishes a missing file from a failed read.
Only `ENOENT` initializes an empty archive. Other filesystem errors propagate
with their original code/path. Existing files must decode as UTF-8 and contain
a JSON array before a save can replace them. Parse/encoding errors retain their
cause and identify the file; non-array data raises a path-bearing TypeError.
Valid Unicode and UTF-8 BOM-prefixed arrays merge normally.

The shared optional JSON reader still supports credential/binding caches and
scan state. Its missing/malformed-cache behavior is checked separately. No public signature,
persisted field, runtime dependency or writer changes. This repair also protects
folder metadata, which uses the same record reader. Concurrent writers and
power-loss durability are outside this slice.

`run.ts` constructs these stores for bookmarks and likes. The collector awaits
each page save before advancing its cursor; failures propagate to its existing
error path. CLI process/browser authentication and live collection were not
exercised. The existing CLI presentation catches errors and reports failure;
this slice does not change its status mapping.

## Behavioral proof

Fixtures use unique `X_ARCHIVE_STATE` roots below `TMPDIR` and real files.
Permission probes verify actual `EACCES`, restore modes in `finally`, and fail
their precondition on a privileged host rather than claim a meaningful pass.
Incoming posts pass the actual Bookmark schema, excluding unrelated parse
failures as an oracle. The scenarios cover:

- Initialization, valid Unicode/BOM merging and account isolation.
- Malformed JSON, non-array JSON and invalid UTF-8: both stores' reads and
  saves reject, retaining exact bytes and structured error context. Unreadable
  files reject saves with their original errno/path after a verified read failure.
- Folder merging preserves untouched metadata; corrupt folder files reject
  reads and saves without replacement.

The original source against the final cases exits 1: eleven intended failures
and four passes. The repaired source passes all fifteen. The original source
is restored from the base revision only inside a bounded, owned worktree
probe, with the candidate restored in `finally`. No user archive is opened.
The intentional-red preparation and full baseline inventory remain in history
at `88b6ad1e1c27fe1f1f88a78e737a9a64a1ae1127`; the current file describes
the completed local fix.

From the project root:

```sh
TMPDIR="$PWD/.work/tmp" cpu-guard --cores 2 -- pnpm exec vitest run \
  x-archive-cli/test/fs-store.test.ts --maxWorkers=1
TMPDIR="$PWD/.work/tmp" cpu-guard --cores 2 -- make lint
```

The former JSON-helper test claimed write-failure atomicity without injecting
a failure. Its title now describes its real round-trip/cache assertions;
missing/malformed optional cache input remains absent and its bytes unchanged.
No atomic-write qualification is implied.

## Coverage and mutation

V8 explicitly includes `x-archive-cli/src/state.ts` and `fs-store.ts`, including
unimported decisions. The four-test baseline reports 36/64 lines and 7/18
branches; the final component reports 59/71 lines and 14/23 branches. Coverage
is informational. The changed reader, not the whole storage subsystem, is
this repair's mutation acceptance scope.

Scratch tools are exact mirrored packages, installed with lifecycle scripts
disabled: Stryker core/runner 10.1.1 and TypeScript 6.0.3, all Apache-2.0.
Project manifests/pins are unchanged. The runner's wrapper resolves Vitest
from the project root; native Vitest and coverage-v8 are 5.0.5. The TypeScript
package and explicit runner plugin are required by Stryker despite project tsrs.
Use an owned scratch config:

```json
{
  "mutate": ["x-archive-cli/src/state.ts", "x-archive-cli/src/fs-store.ts"],
  "testRunner": "vitest",
  "plugins": ["./.work/tmp/fs-tools/node_modules/@stryker-mutator/vitest-runner/dist/src/index.js"],
  "vitest": {"configFile": "vitest.config.ts", "related": false},
  "testFiles": ["x-archive-cli/test/fs-store.test.ts"],
  "coverageAnalysis": "perTest",
  "concurrency": 1,
  "timeoutMS": 10000,
  "timeoutFactor": 1.5,
  "reporters": ["clear-text", "json"],
  "jsonReporter": {"fileName": ".work/tmp/fs-mutation.json"},
  "tempDirName": ".work/tmp/fs-stryker-tmp"
}
```

Hold the campaign's atomic mutation lock, releasing only the acquired lock,
then run `TMPDIR="$PWD/.work/tmp" cpu-guard --cores 2 -- timeout -k 5 1200
.work/tmp/fs-tools/node_modules/.bin/stryker run CONFIG`. Inspect the JSON
classes, recorded source and selected test count rather than just exit 0.
The accepted final JSON source strings compare byte-for-byte with both actual
source files, and the dry run selects exactly fifteen tests.

| Selection | Inventory | Killed | Survived | Uncovered | Timeout/error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Two-file baseline, original source/tests | 95 | 37 | 13 | 45 | 0 |
| Two-file candidate, final source/tests | 117 | 80 | 12 | 25 | 0 |
| Changed `readRecords` within candidate | 24 | 22 | 2 | 0 | 0 |

The runtime edit changes the inventory; these are not fixed-identity detection
scores. Final diagnostic tool cost is 14.78 s, exit 0, not a runtime benchmark.
Every changed-reader mutant has a result. Its two survivors, fs-store IDs 6
and 7 at line 23, relax only `error instanceof Error && "code" in error`.
The only operation inside that catch is Node's `readFileSync` on a string path;
its exceptions are Error objects. Relaxing the redundant guard leaves the
same `ENOENT` decision or propagated exception. Primitive/proxy throws require
replacing the dependency, not a supported filesystem input. These two are
equivalent; no exclusion or accepted risk is added.

The other ten survivors and twenty-five uncovered identities remain unresolved
Tests leads: scan-state paths, empty saves, folder-record filtering, environment
path defaults and write-failure behavior. This repair does not qualify the
complete two-file Scenario or close DSLP-4. The earlier empty-filter control
fell back to broader discovery and was terminated; it does not prove fail-closed
selection. A future whole-change gate must address that explicitly. The actual
nonempty selections above are accounted for, with assertion-killed oracles.

## Validation and limits

All 237 Node tests across 32 files, independent typecheck and adopted type-aware
lint pass. Frozen scripts-disabled installation passes. After mutation stopped,
`/usr/bin/time -p cpu-guard --cores 1 -- make test TEST_ARGS=--maxWorkers=1`
takes 49.46 s (6.98 s user, 3.23 s system), with actual
`perf-gate-ready`/suite/immediate `perf-gate-ready -1` exits 0/0/0. The matched
226-test base observation is 51.54 s. These are suite costs, not speedup claims.
No dedicated CLI-store performance workload is declared; the Onefile workload
is outside this changed path.

The audit regex reports 379 matching lines versus 378 at base. The only added
match is the test title's English phrase `as absent`; no cast, `any`, non-null
assertion or suppression is introduced. Raw regex counts are not a type proof.

Source SHA-256: `fs-store.ts`
`f0cf89a9b0c99f695ef280704670a7e14ca4c986b4f819bb345c896c36b68642`;
unchanged `state.ts`
`2752fe8fc1ed1872ebf3b79386e50dff1e4aab9354851213d363276312fba1a8`.
Test SHA-256: `c44035cab7cefdf387dc1d0b168268b20cdb0c083100a8af54e493d5a817fc61`.
No workflow, production service, user data, credential, deployment or publication
is touched. CLI/browser appliance qualification and the broader Tests lane
remain open.

Independent read-only completion review of `f75b7641..bba2a235` found no
demonstrated defect. It checked the repair, tests and affected collector,
seeding, run and CLI callers from source; it did not claim a live CLI session.
The registered reviewer worktree had no tracked changes or scope drift.
