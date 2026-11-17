# Filesystem storage and state qualification

Scope: `x-archive-cli/src/fs-store.ts` and `state.ts` at base
`aa120bb78309a5a03bdd0e19acdae093afa18267`, with filesystem tests in
`x-archive-cli/test/fs-store.test.ts` and `state.test.ts`. No production code,
public API, persisted format, dependency, or workflow is changed. The generic
optional JSON reader remains deliberately tolerant. The separate strict reader
repair and its earlier inventory are documented in [filesystem store](deslop-filesystem-store.md).

## Scenario inventory

- Record reads: missing, valid, BOM/Unicode, invalid UTF-8, malformed JSON,
  non-array, and non-ENOENT read error; both bookmarks and likes.
- Page saves: missing initialization, merge by tweet ID and available status,
  account separation, empty page over missing/corrupt input, and failed staging
  write preserving existing bytes; both stores.
- Folders: missing, merge/replace, preserve unrelated entries, filter records
  without string IDs, corrupt input rejection.
- Scan state: bookmark and likes independent files, valid state and cursor,
  missing, malformed or schema-invalid read, schema-invalid write and account
  separation. Collector page-save failure precedes cursor checkpoint.
- Paths: override, XDG and home defaults for state/downloads; account store,
  state, credentials and downloads paths. Raw read returns bytes or null.
- Optional JSON: missing, malformed, round-trip and replacement. Writes create
  parent directories, stage and rename; failure test exercises staging failure.

This is a Node filesystem boundary, not browser, live X, concurrent-writer,
power-loss, or whole-change CI qualification. The broader DSLP-4 remains open.

## Validation and controls

Node 26.12.0, pnpm 11.0.2, Vitest 5.0.5, macOS arm64. All commands
use `TMPDIR="$PWD/.work/tmp" CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1
RUSTC_WRAPPER=kache`. Locked scripts-disabled install exited 0. Focused
`cpu-guard --cores 1 -- pnpm exec vitest run x-archive-cli/test/fs-store.test.ts
x-archive-cli/test/state.test.ts --maxWorkers=1` exited 0 (25 tests).
`cpu-guard --cores 1 -- make lint` exited 0 after fixing bracket access in the
new environment tests. `perf-gate-ready`, `/usr/bin/time -l cpu-guard --cores 1
-- make test TEST_ARGS=--maxWorkers=1`, and immediate `perf-gate-ready -1`
exited 0/0/0; 253 tests in 33 files passed. The pre-check first reported a hot
process before eventually returning 0. Wall time 54.48 s, max RSS 176291840
bytes; the earlier 243-test base cost 50.62 s. These are suite observations,
not a runtime speed claim. Production source byte counts and hashes are
unchanged; no build artifact is modified.

For independent fault controls, hold the shared mutation lock, restore each
source immediately after the probe, and run the focused command above with
`-t` and the indicated test name. Each substituted fault exited 1 with an
assertion failure; the unmodified suite passed. All files were restored and
source hashes checked. The first attempt at the path fault was a syntax error;
it was corrected and all controls rerun.

| Test name contains | Temporary fault |
| --- | --- |
| leaves missing and corrupt archives untouched | Replace both empty-page `if (items.length === 0)` conditions with `if (false)`. |
| rejects a failed replacement | Catch the staging `writeFileSync` failure and return without throwing. |
| filters folder records | Replace the string-ID predicate with `true`. |
| validates and isolates bookmark | Replace bookmark `saveState`'s write with `void state`; repeat separately for likes. |
| resolves explicit and default | Replace the first nullish environment selection with `(process.env["X_ARCHIVE_STATE"] || process.env["XDG_STATE_HOME"])`. |
| reads raw bytes | Return null instead of the successful `readFileSync` in `readRawFile`. |
| writes JSON with a requested | Replace the staging write's `{ mode }` with `{}`. |
| does not advance a collector checkpoint | Return `[]` in the strict reader's parse catch instead of throwing. |

Source SHA-256: `fs-store.ts` `f0cf89a9b0c99f695ef280704670a7e14ca4c986b4f819bb345c896c36b68642`,
`state.ts` `2752fe8fc1ed1872ebf3b79386e50dff1e4aab9354851213d363276312fba1a8`.
Test SHA-256: `fs-store.test.ts` `a1cf4deec2779cf233805864b445767c17f20775058a4ecfa491b2f98eaa0e3b`,
`state.test.ts` `d08a8e8f5badf352f0b81b1a3a30ffd5f26b599ff2633a49d667076cc1d1dabc`.

The branch regions in `fs-store.ts` are the record-reader ENOENT and other
error paths, decoding/parse and array checks (18–33); empty/nonempty page
paths, existing-record decode and merge (55–66, 110–121); existing folder ID
filter and merge (69–75); and scan-state decode success/failure and validated
write (78–89, 124–135). In `state.ts` they are the two nullish state-root
fallbacks, downloads override and fallback (5–25); optional-file existence,
read/parse success/failure (28–34); directory/staging/rename writes (37–42);
and raw read success/failure (44–49). Failure at rename and crash or power
loss between staging and rename are not exercised by the staging failure.
`readRawFile` has no production caller found by repository search; its public
helper behavior is covered, without claiming a consumer.

## Complete two-file mutation inventory

Stryker 10.1.1 with its Vitest runner, project Vitest 5.0.5 and separately
resolved TypeScript 6.0.3; one worker, per-test coverage, 10 s timeout and
1.5 timeout factor. The atomic shared lock was held through this command:

```sh
mkdir /Users/josh/d/stuff/.work/tmp/mutation.lock || exit 1
trap 'rmdir /Users/josh/d/stuff/.work/tmp/mutation.lock' EXIT
cat > .work/tmp/storage-stryker.json <<'JSON'
{
  "mutate": ["x-archive-cli/src/state.ts", "x-archive-cli/src/fs-store.ts"],
  "testRunner": "vitest",
  "plugins": ["/Users/josh/repos/extensions/.work/wt/fs/.work/tmp/fs-tools/node_modules/@stryker-mutator/vitest-runner/dist/src/index.js"],
  "vitest": {"configFile": "vitest.config.ts", "related": false},
  "testFiles": ["x-archive-cli/test/fs-store.test.ts", "x-archive-cli/test/state.test.ts"],
  "coverageAnalysis": "perTest", "concurrency": 1, "timeoutMS": 10000, "timeoutFactor": 1.5,
  "reporters": ["clear-text", "json"],
  "jsonReporter": {"fileName": ".work/tmp/storage-mutation.json"},
  "tempDirName": ".work/tmp/storage-stryker-tmp"
}
JSON
cpu-guard --cores 1 -- timeout -k 5 1200 /Users/josh/repos/extensions/.work/wt/fs/.work/tmp/fs-tools/node_modules/.bin/stryker run .work/tmp/storage-stryker.json
jaq -r '.files | to_entries[] | .key as $f | .value.mutants[] | select(.status == "Survived" or .status == "NoCoverage" or .status == "Timeout" or .status == "RuntimeError" or .status == "CompileError") | "\($f):\(.location.start.line) id=\(.id) \(.status) \(.replacement)"' .work/tmp/storage-mutation.json
jaq -j '.files["x-archive-cli/src/fs-store.ts"].source' .work/tmp/storage-mutation.json | cmp - x-archive-cli/src/fs-store.ts
jaq -j '.files["x-archive-cli/src/state.ts"].source' .work/tmp/storage-mutation.json | cmp - x-archive-cli/src/state.ts
```

Exit 0 in 18 s; dry run selected 25 tests. Both source comparisons exit 0.
All 117 identities are accounted for: 114 killed, three survived, zero no
coverage, timeout or error. `fs-store.ts` has 76 identities (74 killed, two
survived); `state.ts` has 41 (40 killed, one survived). The previous same-source
117 inventory had 80 killed, 12 survivors and 25 no coverage. Selection includes
both complete files and both test files; it is not a reader-only repeat.

- `fs-store.ts:23` IDs 6 and 7: equivalent under the supported Node filesystem
  interface. `readFileSync` throws Error objects; the relaxed guards leave the
  ENOENT decision and propagation unchanged. Primitive throws require a
  substituted dependency. This is the earlier reader disposition.
- `state.ts:29` ID 109 removes the pre-read existence check. With a stable
  filesystem, missing paths still produce null through the read catch and
  existing paths behave identically. A file created between the existence check
  and the attempted read distinguishes the mutant: the original returns null,
  the mutant can read it. That concurrent race is **unprotected**, not claimed
  equivalent or owner-accepted; deterministic concurrent cache semantics are
  outside this bounded, nonconcurrent scenario. The optional reader's normal
  missing, malformed and valid inputs are covered.

No identity is unrun. Branch coverage and mutation do not establish
concurrent-writer, rename-failure, power-loss, CLI process, live service or
browser behavior. The collector test uses a synthetic response and the real
filesystem store; it establishes that a rejected page save does not checkpoint.
The two reader guard equivalences and the optional-reader race are distinct;
no exclusion or silent acceptance of the latter is claimed.

A separate lock-protected guard probe replaced the inner `&&` with `||`,
parenthesized before the existing errno check, and ran
`cpu-guard --cores 1 -- pnpm exec vitest run x-archive-cli/test/fs-store.test.ts
--maxWorkers=1 -t 'existing archive cannot be read'`. Exit 0, two EACCES tests
passed; the source was restored and its SHA-256 matches the value above. This
checks the supported error case but does not model substituted primitive throws.
