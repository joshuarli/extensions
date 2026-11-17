Prefix: DSLP
Next: 11

Deslop campaign backlog ([plan](https://github.com/laputa-systems/stuff/blob/main/docs/campaigns/deslop.md), tier Pilot). One agent works this file with the `deslop` skill: take the lowest-numbered open ticket whose area does not start with `Needs owner ·`. After DSLP-5, work the open P1 and P2 findings, then fill in `## Report` below.

## Report

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
DSLP-9 remains unproven against actual
X timeline ordering. DSLP-10 reproduces rejected help syntax at the executable.
The review refreshes download-directory, Node-version and state-privacy docs.
Parent typecheck passes with a two-core cap. Browser runtime, appliance,
live services, credential use and performance were outside this review.
Preserve account-scoped stores, page persistence before cursor advancement,
SQLite page rollback and the suite's ownership of global Chrome listeners.
Bounded Node Stryker evidence is available; broader Tests and browser
qualification remain open. Ground does not qualify the Tests lane.

## Tickets




### DSLP-4 · P2 · Tests: coverage, boundary gaps, mutation

- **Area:** deslop · tests
- **Where:** test suites and CI
- **Problem:** The Vitest/coverage version mismatch is repaired (DSLP-6), and Stryker/coverage tools are mirrored. Whole current first-party coverage, remaining boundary gaps and a qualified whole-change mutation lane remain unfinished. The filesystem-store/state component now has an accounted baseline (95 identities:37 killed,13 survivors,45 uncovered) and a repaired selection (117:80 killed,12 survivors,25 uncovered). At that repair, only the changed record reader's24 identities were qualified:22 killed,two equivalent. The remaining component leads were scan-state paths, empty saves, folder filtering, environment defaults and write-failure behavior. Focused V8 coverage is59/71 lines and14/23 branches; all237 Node tests and lint pass. Historical larger parser/storage/URL results do not qualify changed current inputs. Browser/extension runtime remains a separate boundary. See docs/deslop-filesystem-store.md.
- **Component update:** The prior full filesystem-store/state selection had 117 identities: 114 killed, two equivalent reader guards and one optional-reader precheck survivor. The redundant precheck was removed under the best-effort cache contract; its three mutation identities disappeared. The complete current selection has 114 identities: 112 killed, two equivalent reader guards, zero unrun. Twenty-five focused Node tests and 253 full Node tests pass. Concurrent-writer guarantees remain out of scope. See [storage/state](docs/deslop-storage-state.md). This does not close DSLP-4.
- **Recommendation:** Continue bounded current-version component Scenarios, dispositioning each critical survivor and unrun decision, with public-boundary fault controls. Keep Node and real-browser qualification distinct. Complete first-party coverage reporting and whole-change union/negative controls before relying on a mutation lane; CI changes require separate owner authorization. Accept only when critical survivors, suite-cost budget and supported lane requirements are met.
- **Fix with:** deslop
- **Effort:** M

### DSLP-5 · P2 · Dead code: tools and debloat

- **Area:** deslop · dead code
- **Where:** whole repository
- **Problem:** No dead-code scan has run.
- **Recommendation:** Run the deslop Dead code step. Accept: tools clean or allowlisted with reasons; walk-backs filed as Needs owner tickets.
- **Fix with:** deslop
- **Effort:** M

### DSLP-9 · P2 · Timeline completion does not distinguish captured operations

- **Area:** X archive · durable state
- **Where:** x-archive-core/src/collector.ts:488,577; x-archive-cli/src/profile-db.ts:104; extension-x-bookmarks/src/profile-storage.ts:139
- **Problem:** Assumed P2, unproven against captured X response ordering. Any saved posts=complete enables early stopping for all newly captured profile operations, including when the old reason is complete_without_replies. Known-post queries are shared across operations. If a newly captured Replies timeline first returns already-known posts, collection can stop before older unseen replies and report completion. The collector itself tells users to capture Replies and rerun after a Posts-only scan. No live-service or product witness established the required overlapping-page ordering.
- **Recommendation:** First reproduce using an actual captured overlapping-page fixture. Track completed coverage per operation, or disable early stopping for newly captured operations, so a Posts-only completion cannot certify Replies coverage. Keep this finding explicitly unproven until the trigger is established.
- **Fix with:** durable-state
- **Effort:** M


### DSLP-10 · P3 · CLI help advertises flag syntax the parser rejects

- **Area:** X archive · CLI
- **Where:** x-archive-cli/src/cli.ts:12,27,75,110; x-archive-cli/README.md
- **Problem:** Confirmed on acbedac: pnpm x --help exits 2 and advertises --out DIR, --backend NAME and --session NAME. The same executable rejects space-separated --out with '--out requires =DIR syntax: --out=DIR'; backend and session have equivalent explicit rejection branches. README examples already use equals syntax. No browser or network request is needed to reproduce argument parsing.
- **Recommendation:** Align the advertised and accepted flag syntax, and make explicit help requests succeed. Add bounded executable tests for help and representative accepted/rejected flags without launching a browser.
- **Fix with:** design-cli
- **Effort:** S
