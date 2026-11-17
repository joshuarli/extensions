Prefix: DSLP
Next: 11

Deslop campaign backlog ([plan](https://github.com/laputa-systems/stuff/blob/main/docs/campaigns/deslop.md), tier Pilot). One agent works this file with the `deslop` skill: take the lowest-numbered open ticket whose area does not start with `Needs owner ·`. After DSLP-5, work the open P1 and P2 findings, then fill in `## Report` below.

## Report

DSLP-6 is closed locally: Vitest and coverage-v8 5.0.5 pass the Node tests,
typecheck, and V8 coverage; omitted optional-package engine declarations were
restored after checking published metadata. See [verification](docs/deslop-vitest.md).
Ground passes at `2b3ebe1`: 226 Node tests, typecheck, gated cold/warm costs,
green main CI and a clean shared workflow rule. Diagnose, Types, Tests, and Dead
code remain open. Diagnose files three assumed P2 findings and one P3:
DSLP-7 and DSLP-8 have synthetic product-module reproductions for crash
recovery and archive read failures. DSLP-9 remains unproven against actual
X timeline ordering. DSLP-10 reproduces rejected help syntax at the executable.
The review refreshes download-directory, Node-version and state-privacy docs.
Parent typecheck passes with a two-core cap. Browser runtime, appliance,
live services, credential use and performance were outside this review.
Preserve account-scoped stores, page persistence before cursor advancement,
SQLite page rollback and the suite's ownership of global Chrome listeners.
Stryker and browser tests remain deferred; Ground does not
qualify the Tests lane.

## Tickets



### DSLP-3 · P2 · Types: strict profile and typing findings

- **Area:** deslop · types
- **Where:** type checker and lint configuration; TypeScript sources
- **Problem:** The strict-profile candidates in the deslop skill's tools reference have not been measured here.
- **Recommendation:** Run the deslop Types step. Accept: clean at the adopted profile, escape hatches not increased, witnesses recorded.
- **Fix with:** deslop
- **Effort:** M

### DSLP-4 · P2 · Tests: coverage, boundary gaps, mutation

- **Area:** deslop · tests
- **Where:** test suites and CI
- **Problem:** Coverage and mutation results are unmeasured; no deslop mutation lane exists. Qualification at 910df665: scratch Vitest V8 reports 1,448/2,620 lines (55.26%) and 848/1,670 branches (50.77%), 21 zero-line-coverage files, 7.99s; Vitest 5.0.3 warns coverage-v8 5.0.5 is an unsupported mismatch. Stryker 10.1.1 scoped URL lines 1-10 generated 17 mutants but both attempts stopped before tests: missing typescript package; no mutation classes or runner validity measured. Preliminary knip 6.45.1 default: 16 unused files, 1 unused-dependency group, 9 export groups, 6 type groups, 1 duplicate group, 2.41s; entry-point hints and production mode remain unresolved. Node Vitest excludes browser tests; Onefile Playwright needs built bundles and Chromium. TypeScript readiness: blocked by missing Stryker typescript dependency and unverified runner/runtime, coverage version mismatch; coverage costs 7.99s and mutation cost unknown. Tools are not mirrored (STUF-83). Follow-up qualification supersedes the incomplete mutation and knip notes above: committed package.json and pnpm-lock.yaml pair Vitest 5.0.3 with unsupported coverage-v8 5.0.5 (repository defect). With scratch-only TypeScript 6.0.3 and explicit Vitest plugin, Stryker critical parser/storage/URL: 345 killed, 199 survived, 147 no coverage, 0 timeout/errors, 656.75s; URL lines 1-10: 16 killed, 1 survived, 0 other, 4.94s; timeout is 10000ms + 1.5 times selected test net time + runner overhead. Node baseline ran 51 related tests; endsWith-to-startsWith hand fault failed its URL assertion and matched a killed mutant. Knip with real build entries: default 0 files, 15 unused exports, 8 unused types, 1 duplicate, 2.44s; production 0 files, 38 exports, 11 types, 1 duplicate, 1.84s; test-only consumers explain production false positives. TypeScript readiness: blocked by committed Vitest/coverage-v8 version mismatch; Node mutation works with scratch prerequisite, costs 656.75s critical and 4.94s scoped, browser/extension runtime remains separate, and STUF-83 mirroring is pending.
- **Recommendation:** Run the deslop Tests step. Accept: no undispositioned survivor in critical code, the test cost budget holds, and the lane is green where the tools are mirrored.
- **Fix with:** deslop
- **Effort:** M

### DSLP-5 · P2 · Dead code: tools and debloat

- **Area:** deslop · dead code
- **Where:** whole repository
- **Problem:** No dead-code scan has run.
- **Recommendation:** Run the deslop Dead code step. Accept: tools clean or allowlisted with reasons; walk-backs filed as Needs owner tickets.
- **Fix with:** deslop
- **Effort:** M

### DSLP-7 · P2 · Context completion survives a crash before its posts are saved

- **Area:** X archive · durable state
- **Where:** x-archive-cli/src/context.ts:145,173; x-archive-cli/src/run.ts:330; x-archive-cli/test/fixtures/conversation-page.html
- **Problem:** Assumed P2. Confirmed at acbedac using the actual syncContextThreads and SQLite store with synthetic data. The page is durably marked ok before saveContextPage. An owned child was killed with SIGKILL at its first context save, then the database was reopened: page status ok, context count zero. A normal retry fetched zero pages and retained zero context because the ok page is skipped. The CLI tells users that rerunning resumes this operation. The probe used the existing conversation fixture and focal post 2121991008691130620 with missing parent 2121990345332576733; it injected termination at the store call and did not run a live collection.
- **Recommendation:** Add a bounded process-crash regression using the existing context fixture and an owned SQLite database. Advance completion only after durable processing, or commit posts and completion together. Preserve idempotent retries and the existing treatment of unavailable ancestors.
- **Fix with:** durable-state
- **Effort:** M


### DSLP-8 · P2 · Archive read failures can silently replace saved posts

- **Area:** X archive · durable state
- **Where:** x-archive-cli/src/state.ts:28; x-archive-cli/src/fs-store.ts:17,41; x-archive-cli/src/run.ts:206,250
- **Problem:** Assumed P2. Confirmed at acbedac through the actual FsBookmarksStore on owned synthetic files. Save a valid old post, chmod bookmarks.json to 0200, and confirm readFileSync fails with EACCES. allRecords then returns an empty array. Saving a new valid page succeeds and replaces the old record. readJsonFile also converts malformed JSON to null, and readRecords treats null or wrong-shaped values as empty. Likes share this path. The CLI constructs these stores for collection. Live collection and the frequency of damaged local state were not measured.
- **Recommendation:** Distinguish missing archive files from read, parse and shape failures at the filesystem-store boundary. Preserve original bytes and return an actionable error on failure. Add literal old/new and unreadable/truncated-file regressions. Keep the credential cache's refresh behavior separate from cumulative archives.
- **Fix with:** durable-state
- **Effort:** S


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

