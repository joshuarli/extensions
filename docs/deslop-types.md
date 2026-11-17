# Types profile measurement

Profile baseline: `a737ca1923ce1e2dff305d6b4b1b104d180fb519`, macOS arm64,
Node 26.12.0, pnpm 11.0.2. The measured profile adopts only
`typescript/no-unsafe-argument` for TypeScript files, through pinned Oxlint
1.93.0 and its matching tsrs 0.25.0 provider. The independent compiler gate
remains. A boolean annotation preserves caption element inference without
removing the runtime array guard; one redundant Chrome storage assertion is
deleted. Public signatures, accepted runtime inputs and outputs are unchanged.
Browser and live-service behavior were not tested.

## Compiler

The baseline compiler is `tsrs 0.18.0-ts7.1.0-dev.20260929` (reports
TypeScript `7.1.0-dev.20260930.4`). `pnpm install --frozen-lockfile
--ignore-scripts` and `cpu-guard --cores 2 -- make lint` both exited 0.
`tsconfig.json` already enables `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, and `noUncheckedSideEffectImports`;
they are retained rather than newly adopted. The separate probe
`cpu-guard --cores 2 -- node_modules/.bin/tsrs --noEmit
--verbatimModuleSyntax --pretty false` exited 0 with zero diagnostics. Zero
is not an adoption witness; leave it off. `tsrs --showConfig` exited 5
(unsupported), so the settings above were read from the config directly.

## Scratch lint

The project package exposes only `tsrs`, and has no Oxlint or `tsrs-lint`
binary. For analysis only, installed `oxlint@1.93.0` (MIT) and
`tsrs@0.25.0-ts7.1.0-beta` (Apache-2.0) from
`https://npm.17166969.xyz/current` with `pnpm add --ignore-scripts --save-exact`
in `.work/tmp/analysis`. Package metadata lists no ordinary dependencies;
only platform-specific optional binaries. On this host pnpm installed four
packages: those two and their Darwin arm64 binaries (MIT and Apache-2.0,
respectively), approximately 43 MB by `du -sh` summed after rounding. No
project lockfile or pin changed. The analysis compiler also ran `--noEmit`
against the project and exited 0, but it is not the project's compiler.

Each row below ran with `TMPDIR=$PWD/.work/tmp`, `CARGO_BUILD_JOBS=1`,
`RAYON_NUM_THREADS=1`, the scratch bin directory first on `PATH`, and
`cpu-guard --cores 2 -- oxlint --threads=1 --type-aware -A all -D
typescript/RULE -f json` on the 130 tracked `*.ts` files. A companion scratch
control used the same command on one deliberately violating TypeScript file;
all rows produced the named diagnostic and exit 1. For unary minus the
control was `declare const value: string; -value;`; `-any` is not a valid
negative control for that rule. Controls for the other rules used `any`
assignment, argument, call, member and return; explicit `any`; unsafe enum
assignment/comparison; narrowing assertion; merged interface/class; `Function`;
non-null assertion; unobserved promise; async void callback; redundant
assertion; and a switch missing one union case, respectively. An initial
batch put `-A all` after the configured rules, leaving zero active rules;
its results were discarded and each rule was explicitly enabled afterwards.

| Rule | Project diagnostics | Decision |
| --- | ---: | --- |
| no-explicit-any | 0 | No adoption witness |
| no-unsafe-argument | 4 | Adopt: 4 lost-inference reports, 0 false positives; final 0 |
| no-unsafe-assignment | 5 | Decline: same inference gap plus 3 false positives |
| no-unsafe-call | 0 | No adoption witness |
| no-unsafe-member-access | 8 | Decline: same inference gap plus 1 false positive |
| no-unsafe-return | 8 | Decline: same inference gap plus 3 false positives |
| no-unsafe-enum-assignment | 0 | No adoption witness |
| no-unsafe-enum-comparison | 0 | No adoption witness |
| no-unsafe-type-assertion | 245 | Reject uniform adoption: at least 5 false positives |
| no-unsafe-unary-minus | 0 | No adoption witness |
| no-unsafe-declaration-merging | 0 | No adoption witness |
| no-unsafe-function-type | 0 | No adoption witness |
| no-non-null-assertion | 116 | Reject uniform adoption: at least 5 false positives |
| no-floating-promises | 0 | No adoption witness |
| no-misused-promises | 0 | No adoption witness |
| no-unnecessary-type-assertion | 41 | Reject uniform adoption: at least 4 non-improving reports; one removable hatch |
| switch-exhaustiveness-check | 2 | Reject: 2 false positives, no real witness |

### Classification and witnesses

There are 17,108 tracked TypeScript lines, so four false positives exceed the
one-per-5,000 budget. Counts below classify the complete 25 unsafe
argument/assignment/member/return diagnostics; different rules can report the
same expression.

* `captions.ts:12` applies `Array.isArray` to `readonly CaptionTrack[]`. The
  pinned compiler narrows its element type to `any`. All four argument reports
  (`captions.ts:21,80,82,87`), two assignment reports (`:78,81`), seven member
  reports (`:21,23,69,79,80,82,87`), and five return reports
  (`:23,48,76,84,87`) trace to this loss of inference. This is a real static
  safety gap, not a demonstrated production failure: `types.ts:5-8,71` defines
  the fields, and `youtube-api.ts:30-32,43-47,241-246` decodes the producer
  with Schema before passing tracks to the consumer. The existing exported
  function may have other callers, so preserve its runtime array guard in any
  repair. No live input was used.
* For a reproducible pinned-compiler witness, create a scratch file importing
  `CaptionTrack` from `extension-youtube-transcript/src/types.ts`, declare
  `function f(tracks: readonly CaptionTrack[])`, then after
  `if (!Array.isArray(tracks) || tracks.length === 0) return;` write
  `return tracks[0]?.languageCode.toFixed();`. A scratch config extending the
  project config, with only that file and `noUnusedLocals`/`noUnusedParameters`
  disabled, compiled with `tsrs -p .work/tmp/analysis/witness-config.json
  --pretty false` (exit 0). Removing only the `Array.isArray` condition made
  the corresponding compile exit 2 with TS2551: `toFixed` does not exist on
  `string`. An `IsAny` type check also confirmed the narrowed element is `any`
  while `CaptionTrack` is not. This proves a type-checking hole, not that the
  erroneous call exists in product code.
* The other assignment reports are safe in context: the sparse array at
  `extension-onefile/test/browser/perf-compare.spec.ts:121` gets one result per
  index before `Promise.all` completes (`:130-154`); the `any` array in
  `extension-x-bookmarks/src/debug.ts:10-12` is retained only as storage data
  and `readStatusLog` validates each entry (`:17-26`); and the Vitest matcher
  `expect.any(String)` at `extension-x-bookmarks/test/debug.test.ts:82` is a
  test expectation, not a stored value. These are three false positives.
* The remaining member and return reports at
  `extension-youtube-transcript/test/integration.test.ts:658` inspect JSON
  generated by the request under test and compare it with literal client
  names; malformed structure fails that test. This is one false positive for
  each rule. The other two return reports in
  `x-archive-core/src/conversation.ts:53,55` parse a JSON string enclosed in
  quotes; successful parsing yields a string, otherwise it throws. The caller
  at `:105-111` parses the resulting string as the separate JSON payload.
  These are two more return false positives.

The four unsafe-propagation rules identify the same real lost-inference
contract; their respective false-positive counts are 0, 3, 1 and 3 out of
4, 5, 8 and 8 diagnostics. Under the 17,108-line budget each qualifies for
consideration. Adopt the zero-false-positive argument rule across TypeScript
sources and tests. The other three expose no independent contract in these
findings and would require suppressing legitimate code. Decline those rules
rather than add suppression debt for the same witness. On a production-only
denominator the three-FP rules would exceed the budget. No runtime defect is
asserted.

For `switch-exhaustiveness-check`, both reports are false positives: the
`switch (true)` in `x-archive-cli/src/cli.ts:97-134` dispatches predicates and
has a default target handler; `x-archive-core/src/collector.ts:366-389` has a
deliberate default for the two older operations in `capture.ts:5`, which its
caller selects at `collector.ts:483-487`. The existing test at
`extension-x-bookmarks/test/capture.test.ts:144-145` checks the `UserTweets`
default. This is distinct from the previously recorded CLI help and timeline
ordering findings.

Five concrete false positives for `no-unsafe-type-assertion` are the partial
Chrome tab test doubles in `extension-youtube-transcript/test/integration.test.ts`
lines 197, 212, 233, 253 and 276: the exercised action path accesses `id` and
`url` (`background.ts:100-112,401-405`), both supplied by those fixtures.
The five `no-non-null-assertion` reports at `transcript.test.ts:29,31,45-47`
are test assertions about deliberately nonempty XML fixtures: a missing result
fails the test, rather than exposing a product-path defect. These ten reports
are enough to exceed the budget for their respective blanket rules; other
reports remain unclassified.

`no-unnecessary-type-assertion` found a verified removable hatch at
`extension-x-bookmarks/src/background.ts:80`: the installed Chrome listener's
first parameter is an index signature and `noUncheckedIndexedAccess` already
adds `undefined`. A scratch pinned-compiler type equality witness derived
`Parameters<Parameters<typeof chrome.storage.onChanged.addListener>[0]>[0]`
and proved `typeof changes[key]` equals the asserted
`chrome.storage.StorageChange | undefined` (exit 0). `:81-90` uses the same
local value and `decodeArchiveRun` accepts `unknown`; removing the assertion
preserves runtime, inference, absence, and callers. The parent removes this
assertion; the Chrome dependency already gives the local its exact type.
The rule also reports four DOM queries at `page.ts:169,177,188,244`, suggesting
explicit generic type arguments instead of the assertions. Those generic
arguments still claim the same unverified element type; replacing one spelling
of the hatch with another does not delete trust or reject a bad program. These
four non-improving reports exceed the budget for uniform adoption; the other
36 leads remain unclassified. This removable hatch is a type-only cleanup,
not a proven product defect.

## Adopted contract and regression controls

`make lint` independently runs `pnpm run typecheck`, then `pnpm run lint`.
The Oxlint JSON configuration disables its default correctness category and
enables only `typescript/no-unsafe-argument` on `**/*.ts`; JavaScript build
scripts were not part of this TypeScript measurement. The first unrestricted
invocation also reported 17 unmeasured JavaScript arguments and is not the
adopted scope. A quoted CLI glob selected no files and was discarded; the
accepted configuration uses an override and normal directory discovery.
The accepted file listing includes the 130 tracked TypeScript files.

In `pickCaptionTrack`, the explicit `boolean` local prevents TypeScript's
aliased-condition narrowing from replacing `readonly CaptionTrack[]` with
`any[]`. The expression still calls `Array.isArray` first and reads length
only for arrays; comparing length with zero preserves the old guard exactly.
It does not claim that a predicate validates every element.

The retained must-reject program is the first language normalization changed
to `normalizeLanguageCode(track.languageCode.toFixed())`. Reproduce in an
owned copy of the actual source, then run `pnpm run typecheck`: the old guard
accepts it, exit 0; the new guard rejects exactly this expression with TS2551,
exit 2. Reverting only the guard, without inserting the invalid call, makes
the adopted Oxlint rule emit four `no-unsafe-argument` diagnostics in this
file and exit 1. Restoring the actual source makes `make lint` exit 0.
These source-level controls verify the real implementation and provider;
neither a fabricated runtime failure nor a test-only public API was added.

The provider comes from the Stuff registry with lifecycle scripts disabled.
tsrs replaces the old compiler pin; Oxlint is a new development dependency.
Their package metadata names the maintained oxc-project repositories,
Apache-2.0 and MIT licenses respectively, no ordinary runtime dependencies,
and optional platform binaries. Four matching packages are installed on
Darwin arm64, approximately 43 MB rounded. A few local lines cannot perform
type-aware unsafe propagation analysis. Application dependencies are unchanged,
and neither tool is imported into extension bundles. Frozen installation
passes; no workflow or managed tool installation changed. Scratch controls
do not qualify a mutation CI lane.

## Escape hatches and costs

`git ls-files '*.ts' | xargs rg -Pc '\bas (?!const\b)|\bany\b|@ts-(ignore|expect-error)|(oxlint|eslint)-disable'`
summed by file, counted 379
matching lines before, across 17,108 tracked TypeScript lines: 161
in 10,893 production lines, 218 in 6,040 test lines, and zero in 175 other
lines. The X implementation is an independent port, not imported code
(`extension-x-bookmarks/README.md:302`); Ground records no vendored Onefile
code. It counts lines, not individual hatches.
The final source deletes one matching assertion line; no hatch is added by
the boolean annotation. The profile's baseline is kept separate from the
candidate checks below.

Final source has 378 matching lines, down from 379. The actual Oxlint file
list contains exactly the 130 tracked TypeScript files (sorted lists compare
equal). Frozen install, `make lint`, and the development bundle build pass.
The independent typecheck and lint invocation use the project's installed
providers, not the scratch analysis environment. The extension service-worker
development bundle is 3,660.31 kB as reported by Vite; no runtime dependency
was added. No production build, install or release ran. The declared Onefile
capture workload is outside the changed caption-selection path; no caption
runtime performance workload is declared.

With `TMPDIR=$PWD/.work/tmp`, `/usr/bin/time -p cpu-guard --cores 1 --
make test TEST_ARGS=--maxWorkers=1` passes all 226 tests in 32 files, 51.54 s
wall, 7.24 s user, 3.31 s system. Ground's matched one-core warm observation
is 48.34 s. Candidate `make lint` under the same one-core cap takes 1.16 s,
1.06 s user, 0.56 s system; Ground's typecheck-only lint was 1.17 s.
Each measured invocation has actual pre-gate/test-or-lint/immediate-post-gate
exits 0/0/0. These are suite-cost observations, not speedup claims. The test
cost stays within the deslop allowance. Browser, extension-appliance and
live-service checks remain outside this slice.

Existing CI runs `make test`, so it exercises the new compiler and Node
tests. It does not yet invoke the separate adopted lint command; that is a
recorded CI integration gap, with workflow changes awaiting separate owner
authorization. This profile does not claim a qualified mutation lane.
