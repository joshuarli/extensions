Prefix: EXT
Next: 4

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** x-archive-cli
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-2 · P3 · CLI help advertises flag syntax the parser rejects

- **Area:** X archive · CLI
- **Where:** x-archive-cli/src/cli.ts:12,27,75,110; x-archive-cli/README.md
- **Problem:** Confirmed on acbedac: pnpm x --help exits 2 and advertises --out DIR, --backend NAME and --session NAME. The same executable rejects space-separated --out with '--out requires =DIR syntax: --out=DIR'; backend and session have equivalent explicit rejection branches. README examples already use equals syntax. No browser or network request is needed to reproduce argument parsing.
- **Recommendation:** Align the advertised and accepted flag syntax, and make explicit help requests succeed. Add bounded executable tests for help and representative accepted/rejected flags without launching a browser.
- **Fix with:** design-cli
- **Effort:** S

### EXT-3 · P3 · Complete performance workload coverage

- **Area:** benchmarks
- **Where:** extension-onefile/test/browser/perf-compare.spec.ts; x-archive-cli; onefile-cli
- **Problem:** The Onefile harness checks fixture markers and archive bytes but its upstream comparison needs a separately provisioned reference; download, peak memory and process-tree attribution are not measured. X collection/export, extension startup and CLI journeys have no representative benchmark or attribution path.
- **Recommendation:** Add realistic offline workloads and correctness oracles, process-tree CPU and memory attribution, and a pinned available comparator; establish paired host-gated budgets before claiming regressions.
- **Fix with:** bench-pyramid
- **Effort:** M
