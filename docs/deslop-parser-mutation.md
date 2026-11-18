# Bookmark parser mutation evidence

The selection covers instruction admission, timeline entry dispatch and
folder parsing in `x-archive-core/src/parser.ts`. All three runs used
source blob `b5f2e25b87fb21d9d7534733edda7fc0502b1f44`. The reports
contain identical identities by ID, source location, operator and replacement.

| Tests | Selected | Caught | Survived | Uncovered | Local run |
| --- | ---: | ---: | ---: | ---: | --- |
| Base `e1364700` | 179 | 139 | 27 | 13 | 7m 29s |
| Folder and cursor admission, #19 | 179 | 167 | 10 | 2 | 7m 31s |
| Exact timeline diagnostics | 179 | 178 | 1 | 0 | 7m 34s |

The final run executed 65 test cases during baseline collection. There
were zero timeouts and zero errors across all three runs. The final
`parser.test.ts` blob is `23da1260683203590a6c293953d7001feb111da1`.

The remaining equivalent identity is Stryker ID 113, a block-statement
mutant at line 319. It replaces the final `else { continue; }` with an
empty block. Both forms reach the next iteration because there are no
statements after that block in the entry loop.

## Reproduce the selection

Use Node 26.13.1, project Vitest 5.0.5, and mirrored temporary tools
Stryker core and Vitest runner 10.1.1 and TypeScript 6.0.3. Install the
project from its lock and put the tools under `.work/tmp/parser-tools`.
Keep npm lifecycle scripts disabled during installation. Set `TMPDIR`
to the checkout's `.work/tmp`.

```json
{
  "mutate": [
    "x-archive-core/src/parser.ts:226:1-238:1",
    "x-archive-core/src/parser.ts:291:1-333:1",
    "x-archive-core/src/parser.ts:384:1-421:1"
  ],
  "testRunner": "vitest",
  "plugins": [
    "./.work/tmp/parser-tools/node_modules/@stryker-mutator/vitest-runner/dist/src/index.js"
  ],
  "vitest": {"configFile": "vitest.config.ts", "related": false},
  "testFiles": [
    "extension-x-bookmarks/test/parser.test.ts",
    "extension-x-bookmarks/test/likes.test.ts",
    "extension-x-bookmarks/test/profile.test.ts"
  ],
  "coverageAnalysis": "perTest",
  "concurrency": 1,
  "timeoutMS": 10000,
  "timeoutFactor": 1.5,
  "reporters": ["clear-text", "json"],
  "jsonReporter": {"fileName": ".work/tmp/parser-mutation.json"},
  "tempDirName": ".work/tmp/parser-stryker-tmp"
}
```

Save the configuration in `.work/tmp/parser-stryker.json`. Run
`.work/tmp/parser-tools/node_modules/.bin/stryker run .work/tmp/parser-stryker.json`
with a 20-minute outer limit. Compare the embedded source with the
checkout and sort identity fields by ID before comparing the JSON reports.
Stryker warned while preprocessing the unrelated `conversation-page.html`
fixture. The selected parser source matched and all selected dry runs passed.
Other parser helpers, real browser behavior and the whole-change gate
are separate scopes.
