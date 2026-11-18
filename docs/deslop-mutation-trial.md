# Extensions whole-change mutation trial

The trial runs Stryker 10.1.1 over bookmark admission and dispatch plus
the complete Node filesystem archive store and state helper. Installed
Chromium continues to exercise the capture corpus and service-worker
lifecycle in its separate job. Other source files, browser-only mutation
and Onefile resource ownership still need witnesses. The trial refuses
source paths without a selected witness.

On local macOS arm64 with Node 26.13.1 and project Vitest 5.0.5, the
driver at `323604d` reported 178 caught and one equivalent for parser
in 7m 30s, and 112 caught and two equivalent for storage in 15s.
There were no timeouts, execution errors or uncovered identities.
The [parser](deslop-parser-mutation.md) and
[storage](deslop-storage-state.md) evidence explains the equivalents.
The trial matches their exact source by digest and mutation location.

## Controls

Run the same gate against the commit immediately before each isolated
change. Use `MUTANTS_SCOPE=--shard=storage` for these storage controls.
The two storage test files and TypeScript checking still passed in the
three negative cases.

| Change | Expected result and observed witness |
| --- | --- |
| Remove the private file mode and newline test in `state.test.ts` | The mode-object and newline-string mutations in `state.ts:39` survived. All 24 remaining focused tests passed. |
| Also split the existing optional state read and decode into two statements in `fs-store.ts` | The full changed file and the protected state file both ran. The known reader expressions are unchanged, so the control records the exact updated file digest for their equivalents. The same two state mutations survived while the changed read path's mutations were caught. All 24 focused tests passed. |
| Add an early return in `writeJsonFile` for an untested `.unused` suffix | Two condition mutations survived at the new decision. All 25 focused tests passed. |
| Append a blank line to this storage evidence | The full change was classified as documentation and selected no jobs. |

## Run it

Follow the pinned install commands in the hosted mutation trial. The
tool installation lives in the ignored workspace directory. Run
`BASE=origin/main make mutants-diff`, or set `MUTANTS_SCOPE` to
`--shard=parser` or `--shard=storage`. The driver verifies a clean
checkout for execution. To preview working-tree changes, use
`node scripts/mutants-diff.mjs origin/main --plan`.

Hosted positive and negative results, full platform coverage, and the
whole-suite cost requirement remain open. Keep the draft out of fleet
retention until those results and the remaining critical scopes qualify.
