# Types profile measurement (partial)

Measured at `a737ca1923ce1e2dff305d6b4b1b104d180fb519`, macOS arm64,
Node 26.12.0, pnpm 11.0.2. This is not completion of DSLP-3. No
configuration, source, dependency, or runtime change was made. The existing
Ground full Node test result remains applicable because those inputs did not
change. Browser and live-service behavior were not tested.

## Compiler

The project compiler is `tsrs 0.18.0-ts7.1.0-dev.20260929` (reports
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
| no-unsafe-argument | 4 | Unclassified |
| no-unsafe-assignment | 5 | Unclassified |
| no-unsafe-call | 0 | No adoption witness |
| no-unsafe-member-access | 8 | Unclassified |
| no-unsafe-return | 8 | Unclassified |
| no-unsafe-enum-assignment | 0 | No adoption witness |
| no-unsafe-enum-comparison | 0 | No adoption witness |
| no-unsafe-type-assertion | 245 | Unclassified |
| no-unsafe-unary-minus | 0 | No adoption witness |
| no-unsafe-declaration-merging | 0 | No adoption witness |
| no-unsafe-function-type | 0 | No adoption witness |
| no-non-null-assertion | 116 | Unclassified |
| no-floating-promises | 0 | No adoption witness |
| no-misused-promises | 0 | No adoption witness |
| no-unnecessary-type-assertion | 41 | Unclassified |
| switch-exhaustiveness-check | 2 | Unclassified; examples below |

The switch findings show why diagnostics alone cannot justify adoption:
`x-archive-cli/src/cli.ts:97` intentionally switches on `true` to dispatch
predicates, while `x-archive-core/src/collector.ts:366` uses a default for
other profile operations. Whether each default is semantically complete
requires caller and external-domain analysis; neither is a proven defect.
The `no-unnecessary-type-assertion` lead at
`extension-x-bookmarks/src/background.ts:80` may delete a hatch, but its
contract and callers have not been verified. The `any` reports in
`extension-youtube-transcript/src/captions.ts:21` and nearby require tracing
`CaptionTrack` from its Effect Schema and the `Array.isArray` narrowing;
they are not established product defects. No executable product-defect
witness was established and remaining findings are not classified as false.

Adopting type-aware lint would require introducing a project lint provider,
which is outside this lane's permitted dependency and pin changes. More
source-level classification is also required to establish a real witness and
the false-positive budget. Do not treat an unavailable project provider, a
zero count, or this scratch run as a rejection of a useful safety rule. This
profile remains unfinished; no CI qualification is claimed.

## Escape hatches and costs

`git ls-files '*.ts' | xargs rg -Pc '\bas (?!const\b)|\bany\b|@ts-(ignore|expect-error)|(oxlint|eslint)-disable'`
summed by file, counted 379
matching lines before and after, across 17,108 tracked TypeScript lines. This
includes tests and the repository's independent X implementation; Ground
records no vendored Onefile code. It counts lines, not individual hatches.
No timed claim was measured or made; the earlier Ground costs apply only to
its recorded environment. Scratch tooling and static documentation do not
change runtime performance.
