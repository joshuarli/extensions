# Vitest 5.0.5 verification

DSLP-6 corrects the unsupported Vitest 5.0.3 and coverage-v8 5.0.5 pair.
Both direct dependencies are pinned to 5.0.5. The coverage package declares
an exact 5.0.5 Vitest peer, and Vitest declares the reciprocal exact peer.
The lock also updates existing mocker and spy to 5.0.5, magic-string to 1.4.5,
and tinybench to 6.2.3; Vitest now shares the existing obug 3.0.0, removing
obug 2.2.1. No new dependency names were added. These test dependencies are
MIT licensed, according to their published package metadata; their existing
role as the test runner and coverage provider makes replacement unnecessary.
No build-time or bundle-size effect was measured on this busy host.

The regenerated lock omitted engine declarations for nine Rolldown 1.2.12
and five Lightning CSS 1.33.0 optional bindings. Each corresponding npm
package metadata entry still declares the original constraint: Rolldown
`^20.19.0 || >=22.12.0`, Lightning CSS `>= 12.0.0`. The declarations were
restored. Both cover the project's Node range (`^22.12.0 || ^24.0.0 ||
>=26.0.0`); CI selects Node 22, subject to that minimum. The mirror root
returned 404 for the queried package metadata, so this comparison used
`npm view --registry=https://registry.npmjs.org PACKAGE@VERSION name version
engines license --json` for each affected package, parsed with `jaq`. It does
not establish why the metadata was omitted or test those other platforms.

On macOS with Node 26.12.0 and pnpm 11.0.2, sequential commands returned 0:

- `env CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- pnpm install --frozen-lockfile --ignore-scripts` (also repeated after restoring engine metadata): lockfile up to date; 5.0.5 pair installed.
- `env CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- pnpm run typecheck`: passed.
- `env CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 cpu-guard --cores 1 -- pnpm run vitest run --maxWorkers=1 --coverage`: 26 files and 199 tests passed; V8 coverage lines 2110/2785 and branches 1328/2093. No version mismatch warning appeared. The test config excludes browser tests; default coverage includes loaded files, so these totals are not directly comparable with the earlier scratch report.

Stryker, browser tests, CI's Node 22 execution, and test-cost or performance
qualification remain unverified. No time-based conclusion is drawn from this
run. DSLP-4 remains open and this result does not qualify a mutation lane.
