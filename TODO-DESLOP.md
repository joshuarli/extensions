Prefix: DSLP
Next: 13

Deslop campaign backlog ([plan](https://github.com/laputa-systems/stuff/blob/main/docs/campaigns/deslop.md), tier Pilot). One agent works this file with the `deslop` skill: take the lowest-numbered open ticket whose area does not start with `Needs owner ·`. After DSLP-5, work the open P1 and P2 findings, then fill in `## Report` below.

## Report

Completion review: reviewed the cumulative diff from 10f6101 through the
local benchmark change, including profile state schema, both persistence
adapters and the scanner and benchmark records. The profile repair is an
additive persisted-format change; legacy records rescan. The benchmark preflight
checks selected bundles, fixture and Chromium and warns on direct-source
staleness; it does not establish process-tree cleanup, free disk, all transitive
input freshness or a timing gate. The default Knip candidates and structural
debloat sweep are incomplete rather than clean or allowlisted; see DSLP-11.
No independent reviewer was delegated under the lane's leaf constraint.


Bench audit: Onefile save has small, article, image-heavy and CSS-heavy
Chromium fixtures and output-marker checks. The selective entrypoint provides
Edit selection checks and one Change workload; `make bench-list`, `make
bench-check`, `make bench BENCH_ARGS='--tier=edit'` and `make bench
BENCH_ARGS='--tier=change --workload=small'`. Full was not run. The latter
completed five unpaired samples with a 5,702-byte archive; host readiness and
upstream comparison were not established, so no timing verdict is claimed.
Needs environment: separately provisioned upstream comparator. Download,
peak memory, CPU/I/O attribution, X collection/export, CLI and extension
startup outcomes are gaps filed as DSLP-12. No benchmark CI scope changed.

Timeline finding: the synthetic response fixture reproduces an overlapping
first Replies page and older unseen reply; before repair it fetched one page
and falsely completed. Per-operation completion now persists additively in
profile state; older states rescan. Focused 36 tests passed. Temporarily
removing the guard made the new case fail (1 instead of 2 pages); restoring
source byte-for-byte passed `cmp`. Both IndexedDB and SQLite consumers decode
the additive schema. Live X ordering and cross-version readers are unverified.


Dead code: Knip 6.45.1 was run with Vite, page, injected, CLI and test
entries. Default mode reported 22 export groups, 17 type groups and one
duplicate; production mode exited 0. No file or dependency candidates remained
in default mode after including HTML scripts and the child-process fixture.
The export candidates are not yet proven safe removals; DSLP-11 retains them.
No live contract was removed. Structural debloat review remains incomplete;
retained recovery, state, format and extension boundaries are named below.

Tests finite inventory (base 10f6101, Node 26 and installed Chromium):

- Suite manifest/worker and message schemas: `extension-contract.test.ts` and
  `extension-suite/test/message-contract.test.ts`; installed worker and toggle:
  `extension-runtime.spec.ts`. Worker restart, update, and capture-to-download
  remain untested in an installed extension. `docs/deslop-mv3-runtime.md`.
- Right-click restoration: `user-select-restoration.browser.test.ts`. Onefile
  capture, resource and viewer boundaries: `capture.spec.ts`, `hardening.spec.ts`,
  `polyglot-render.spec.ts`; archive formats: `zip.test.ts`, `polyglot.test.ts`,
  `archive-integrity.test.ts`. Pixel equivalence, all resource types and real
  downloads remain untested. `docs/deslop-browser-capture.md`.
- X messages, GraphQL parsing and capture: `message-contract.test.ts`,
  `api.test.ts`, `parser.test.ts`, `capture.test.ts`; archive decisions and
  account-scoped persistence: `storage.test.ts`, `likes.test.ts`, `profile.test.ts`,
  `fs-store.test.ts`, `state.test.ts`, `backend.test.ts`. Page save before cursor,
  recovery, replacement, and per-operation completion have focused witnesses.
  Real X ordering, concurrent writers, power loss and complete export end-to-end
  remain untested. X CLI process flags/exit codes remain a gap (DSLP-10).
- YouTube message and HTTP/transcript parsing: `message-contract.test.ts`,
  `http.test.ts`, `transcript.test.ts`; live endpoints untested. Onefile CLI and
  formats use `onefile-cli/test` and format tests; live services are excluded.
- Decision dispositions: parser 178/179 killed, final identity equivalent
  (end-of-loop continue); zero timeout or uncovered in selection. Storage 112/114
  killed, two equivalent Error guards; zero timeout/unrun. Onefile metadata
  35/44 killed: three equivalent offset comparisons; loop bound/update,
  wrapper and nonconvergence diagnostics are untested survivors (IDs 12, 14,
  15, 24, 26, 45; including two uncovered). These are advisory risks, not proven
  defects. See `docs/deslop-parser-mutation.md`, `docs/deslop-storage-state.md`,
  `docs/deslop-onefile-archive.md`. Other parser helpers, resource ownership,
  browser effects and whole-change mutation union were not run; no exhaustive
  mutation claim. The remaining browser effects above are accepted gaps.
- Coverage at 6625922: 2,615/4,715 lines, 1,693/3,393 branches, 273 tests;
  no coverage threshold. Retained CI lanes are unchanged. Current acceptance:
  `TMPDIR=$PWD/.work/tmp make test TEST_ARGS=--maxWorkers=1`, `make lint`, and
  `pnpm run test:browser --workers=1` for installed Chromium. Consumers are the
  suite extension and X/Onefile CLIs; no live X or YouTube requests. Gated warm
  baseline 51.54s; host contention prevents a paired cost conclusion here.
  Prior installed Chromium evidence is recorded separately, not Node coverage.

DSLP-6 is closed locally: Vitest and coverage-v8 5.0.5 pass the Node tests,
typecheck, and V8 coverage; omitted optional-package engine declarations were
restored after checking published metadata. See [verification](docs/deslop-vitest.md).
Ground passes at `2b3ebe1`: 226 Node tests, typecheck, gated cold/warm costs,
green main CI and a clean shared workflow rule. Types adopts the measured
TypeScript unsafe-argument rule, preserves caption inference and removes a
redundant assertion: 379 to 378 hatch-matching lines, 226 tests and lint clean.
Types baseline warm test/lint costs are 51.54/1.16s; full evidence and the
separate lint CI integration gap are in docs/deslop-types.md. Tests and Dead
code remain open. Diagnose files three assumed P2 findings and one P3:
DSLP-7 is repaired with crash/reopen and legacy completion regression evidence in docs/deslop-context-recovery.md.
DSLP-8 is repaired: strict record reads reject unreadable/corrupt snapshots
before replacement while optional-cache semantics remain separate. The final
fifteen-case component has eleven intended failures on original source; all
237 Node tests and lint pass on the repair. Its changed reader has 24 mutation
identities, 22 killed and two equivalent; broader storage qualification remains
open. Gated warm suite cost is 49.46s; evidence: docs/deslop-filesystem-store.md.
DSLP-9 is fixed for deterministic overlapping response shapes; live X ordering remains unverified. DSLP-10 reproduces rejected help syntax at the executable.
The review refreshes download-directory, Node-version and state-privacy docs.
Parent typecheck passes with a two-core cap. Browser runtime, appliance,
live services, credential use and performance were outside this review.
Preserve account-scoped stores, page persistence before cursor advancement,
SQLite page rollback and the suite's ownership of global Chrome listeners.
Bounded Node Stryker evidence is available; broader Tests and browser
qualification remain open. Ground does not qualify the Tests lane.

The prior full filesystem-store/state selection had 117 identities: 114 killed, two equivalent reader guards and one optional-reader precheck survivor. The redundant precheck was removed under the best-effort cache contract; its three mutation identities disappeared. The complete current selection has 114 identities: 112 killed, two equivalent reader guards, zero unrun. Twenty-five focused Node tests and 253 full Node tests pass. Concurrent-writer guarantees remain out of scope. See [storage/state](docs/deslop-storage-state.md). This does not close DSLP-4.

Extensions #15 merged the adopted type-aware lint rule and an installed
Chromium job. Both checks passed on `1ad499ed4b3e8201eb54a09a8cdbae6493959b8a`.
The installed test observes real MV3 service worker messages and an
injected right-click toggle. The lint and installed browser case also
passed locally after temporarily removing this backlog. Stuff still
needs to register the retained guarantees. The whole-change mutation gate,
broader browser boundaries and test cost remain open.

At `6625922`, the first-party Node coverage target passed 273 tests
with Vitest and V8 5.0.5 on macOS arm64 and Node 26.13.1. It records
2,615 of 4,715 lines and 1,693 of 3,393 branches. The default discovery
run had the same covered counts over 3,461 lines and 2,715 branches.
The wider denominator includes unimported modules such as Onefile's
browser background entry. Node coverage and installed Chromium results
remain separate. The TypeScript mutation gate is open.

## Tickets

### DSLP-10 · P3 · CLI help advertises flag syntax the parser rejects

- **Area:** X archive · CLI
- **Where:** x-archive-cli/src/cli.ts:12,27,75,110; x-archive-cli/README.md
- **Problem:** Confirmed on acbedac: pnpm x --help exits 2 and advertises --out DIR, --backend NAME and --session NAME. The same executable rejects space-separated --out with '--out requires =DIR syntax: --out=DIR'; backend and session have equivalent explicit rejection branches. README examples already use equals syntax. No browser or network request is needed to reproduce argument parsing.
- **Recommendation:** Align the advertised and accepted flag syntax, and make explicit help requests succeed. Add bounded executable tests for help and representative accepted/rejected flags without launching a browser.
- **Fix with:** design-cli
- **Effort:** S

### DSLP-11 · P3 · Review unused export candidates

- **Area:** deslop · dead code
- **Where:** extension-*/src, x-archive-core/src, x-archive-cli/src
- **Problem:** Knip 6.45.1 default mode reports 22 export groups, 17 type groups and one duplicate after Vite, CLI, injected, HTML and test entry points are included. Some are compatibility re-exports or public surfaces; no removal has been established safe. Production mode reports no issues under the same entry configuration.
- **Recommendation:** Trace each candidate through callers, documentation and external consumers before removing only behavior-preserving exports; treat public removals as owner walk-backs.
- **Fix with:** dead-code-archaeology
- **Effort:** M

### DSLP-12 · P3 · Complete performance workload coverage

- **Area:** deslop · benchmarks
- **Where:** extension-onefile/test/browser/perf-compare.spec.ts; x-archive-cli; onefile-cli
- **Problem:** The Onefile harness checks fixture markers and archive bytes but its upstream comparison needs a separately provisioned reference; download, peak memory and process-tree attribution are not measured. X collection/export, extension startup and CLI journeys have no representative benchmark or attribution path.
- **Recommendation:** Add realistic offline workloads and correctness oracles, process-tree CPU and memory attribution, and a pinned available comparator; establish paired host-gated budgets before claiming regressions.
- **Fix with:** bench-pyramid
- **Effort:** M

