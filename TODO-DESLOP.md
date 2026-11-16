Prefix: DSLP
Next: 7

Deslop campaign backlog ([plan](https://github.com/laputa-systems/stuff/blob/main/docs/campaigns/deslop.md), tier Pilot). One agent works this file with the `deslop` skill: take the lowest-numbered open ticket whose area does not start with `Needs owner ·`. After DSLP-5, work the open P1 and P2 findings, then fill in `## Report` below.

## Report

Not started.

Owner stop, 2026-11-16: an unqualified DSLP-6 candidate pins Vitest and
coverage-v8 to the matching 5.0.5 pair. The lockfile was regenerated using the
stuff npm mirror with lifecycle scripts disabled; frozen installation passed.
Tests, coverage and Stryker were not run. The regenerated lockfile also changes
optional-package engine metadata; inspect that before accepting the candidate.
No ticket is closed. Work is stopped; resume only at the owner's request.

## Tickets

### DSLP-1 · P2 · Ground: baseline, boundaries, and CI test entry point

- **Area:** deslop · ground
- **Where:** AGENTS.md, Makefile, .github/workflows/
- **Problem:** Base ac4f9d4; code lines TypeScript 9.6k (fleet/loc/v1, vendored included); timings not yet measured. CI does not run make test: runs tests directly on pull requests; run make test or make test-ci instead so CI and local verification share one entry point. Open fleet lint findings: mdtool 10, audit-upgrades 9, audit-vuln 6, typescript-stack 6, gha-syntax 2, gha-lint-workflow 1, make-clean-target 1, make-lint-target 1, and 3 more. Perf gate: decide in Ground whether a user-visible hot path needs a workload.
- **Recommendation:** Run the deslop Ground step. Accept: CI runs make test and is green, and AGENTS.md has a Verification section.
- **Fix with:** deslop
- **Effort:** S

### DSLP-2 · P2 · Diagnose: ultrareview into this backlog

- **Area:** deslop · diagnose
- **Where:** whole repository
- **Problem:** No review has ranked this repository's risks for the deslop pass.
- **Recommendation:** Run the deslop Diagnose step. Accept: the diff touches only docs, comments, and this file, and every finding names its Fix with.
- **Fix with:** deslop
- **Effort:** S

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


### DSLP-6 · P2 · Committed Vitest and coverage-v8 versions are an unsupported pair

- **Area:** Tests · tooling
- **Where:** package.json:28, pnpm-lock.yaml:21
- **Problem:** package.json and pnpm-lock.yaml pair vitest 5.0.3 with @vitest/coverage-v8 5.0.5; Vitest warns the mixed versions are unsupported, so coverage totals (55.26% lines, 50.77% branches at 910df665) are provisional.
- **Recommendation:** Pin @vitest/coverage-v8 to the installed Vitest version (or bump both together from the stuff registry), regenerate the lock, and re-measure coverage.
- **Fix with:** test-audit
- **Effort:** S

