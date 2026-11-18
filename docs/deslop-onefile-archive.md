# Onefile archive metadata evidence

The test verifies three outputs of `buildPolyglot`: the returned metadata,
the ZIP's stored `metadata.json`, and the HTML prefix's index. It checks
the resource name, MIME type, byte length and CRC, the wrapper's closing
bytes, and the difference between the full unresolved list and the 25-entry
HTML sample.

At `cc3ee46`, Stryker 10.1.1 selected 44 identities in `buildPolyglot`.
The existing tests caught 26, with 16 survivors and two uncovered identities.
The metadata assertions caught 35 of those same 44, with seven survivors
and two uncovered. Both runs had zero timeouts and errors. The paired
production blob was `d39c49ced9d5305679cb8886acfbb879208226b8`.
All 23 focused Vitest tests, TypeScript checking and lint passed.

IDs 30, 31 and 33 are equivalent. The archive offset and prefix guess
both start at zero and both receive the same prefix length after each
unsuccessful iteration. The two equality tests therefore always have
the same result. The loop bound and update (IDs 12, 14 and 15), the
missing-wrapper condition and diagnostic (24 and 26), and the final
nonconvergence diagnostic (45) still need separate decisions.

Use the [parser Stryker setup](deslop-parser-mutation.md#reproduce-the-selection).
Select `extension-onefile/src/polyglot.ts:121:1-177:2` with
`extension-onefile/test/polyglot.test.ts`,
`extension-onefile/test/archive-integrity.test.ts` and
`extension-onefile/test/workflow.test.ts`. Compare the same identity
fields and source bytes. This result covers archive metadata construction
and leaves browser rendering and resource ownership in the wider Tests scope.
