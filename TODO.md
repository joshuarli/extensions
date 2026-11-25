Prefix: EXT
Next: 12

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-4 · P2 · Port the Instagram archiver here as instagram-archive-core and instagram-archive-cli

- **Area:** Instagram archive
- **Where:** new instagram-archive-core/ and instagram-archive-cli/ (shape: x-archive-core, x-archive-cli); reference implementation ~/repos/shadowdriver/ig (Python, the parity oracle) and ~/repos/shadowdriver/ig-ts (frozen TS prototype, raw material); session pattern: x-archive-cli/src/deps.ts and x-archive-core/src/session.ts
- **Problem:** Owner decision 2026-11-22: IG leaves Shadowdriver and becomes a terminal archiver in this repository, reading the logged-in session over CDP from Helium or a bctl appliance (--backend=bctl) the way x-archive-cli does, without stealth scripts. Shadowdriver keeps only Grab, and its IG, ig-ts and Node SDK trees are deleted once this port reaches parity (SHD-51). The hard part is media fidelity: HQ video and separate audio tracks currently come from CDP response-body capture and an ffmpeg mux.
- **Recommendation:** Gate 1, a one-to-two-day spike: a collector on the x-archive session pattern, checked against Python ig on a fixed set of 20 to 30 posts (a profile needing more than one page, a saved collection, image and mixed carousels, reels with audio, one HQ video). Compare post identity, membership, carousel order, dimensions, audio presence and duration. Any silent loss fails the spike. Gate 2: port saved and profile membership, resumable downloads, completion checks, the ffmpeg mux and the static gallery, reusing x-archive-core merge, storage and render patterns. Carry Shadowdriver SHD-49: any rate limit, login redirect, checkpoint or unrecognized response parks the whole job with its reason across restarts until a deliberate resume. Use synthetic fixtures only: this repository is public and the IG tree holds personal archive files. Add a suite feature only if passive credential capture is needed, following extension-x-archive.
- **Fix with:** reference-parity
- **Effort:** L

### EXT-5 · P3 · Cover Onefile archive wrapper and convergence failures

- **Area:** Onefile archive
- **Where:** extension-onefile/src/polyglot.ts:151; extension-onefile/test/polyglot.test.ts
- **Problem:** The archive wrapper selection, iteration bound and nonconvergence failure paths lack resolved behavioral coverage; incorrect offset handling could produce an unreadable archive.
- **Recommendation:** Determine reachable failure cases and add focused behavioral tests for the wrapper and convergence contract.
- **Fix with:** none
- **Effort:** M

### EXT-6 · P3 · Exercise X archive CLI process and complete export

- **Area:** X archive CLI
- **Where:** x-archive-cli/test/args.test.ts; x-archive-cli/src/main.ts; x-archive-cli/src/run.ts
- **Problem:** Argument tests exercise parsing, but the CLI process boundary and complete JSON, media and HTML export contract are not covered end to end.
- **Recommendation:** Drive the CLI as a process against synthetic service fixtures and verify exit status and exported archive contents.
- **Fix with:** none
- **Effort:** M

### EXT-7 · P3 · Exercise installed extension worker lifecycle

- **Area:** Suite runtime
- **Where:** extension-onefile/test/browser/extension-runtime.spec.ts; extension-suite/src/service-worker.ts
- **Problem:** The installed Chromium test exercises a right-click toggle in one worker lifetime but does not establish behavior after worker restart or extension update.
- **Recommendation:** Add installed-suite browser coverage for worker restart and update behavior with persisted state.
- **Fix with:** lifecycle-concurrency
- **Effort:** M

### EXT-8 · P3 · Verify archive replacement failure at rename

- **Area:** X archive storage
- **Where:** x-archive-cli/src/state.ts:36; x-archive-cli/test/state.test.ts; x-archive-cli/test/fs-store.test.ts
- **Problem:** Tests cover staging write failure but do not exercise rename failure or a crash between staging and rename, leaving archive replacement recovery unverified.
- **Recommendation:** Test rename failure and interruption using isolated files and verify the old archive and recovery behavior.
- **Fix with:** durable-state
- **Effort:** M

### EXT-10 · P3 · Exercise Onefile capture and download in the installed suite

- **Area:** Onefile capture
- **Where:** extension-onefile/test/browser/capture.spec.ts:84; extension-onefile/test/browser/extension-runtime.spec.ts
- **Problem:** The capture corpus injects the capture bundle into ordinary pages, and the installed suite test covers only the right-click toggle; the installed capture-to-download path is unverified.
- **Recommendation:** Drive Onefile capture through the installed suite against a local fixture and verify the downloaded archive contents.
- **Fix with:** none
- **Effort:** M

### EXT-11 · P3 · Qualify concurrent X archive filesystem writers

- **Area:** X archive storage
- **Where:** x-archive-cli/src/state.ts:36; x-archive-cli/src/fs-store.ts:55
- **Problem:** The filesystem store reads, merges and replaces records using a shared staging filename; concurrent writers and power-loss durability are unqualified.
- **Recommendation:** Establish the supported writer and durability contract, then test or enforce it for concurrent runs and interrupted writes.
- **Fix with:** durable-state
- **Effort:** M

### EXT-9 · P4 · Qualify live X and YouTube service boundaries

- **Area:** Service integration
- **Where:** x-archive-core/test/api.test.ts; extension-youtube-transcript/test/http.test.ts; extension-youtube-transcript/test/integration.test.ts
- **Problem:** Service tests use fixtures or mocks, leaving compatibility with live X and YouTube endpoints unverified.
- **Recommendation:** Define and run an owner-authorized live qualification using suitable accounts and retain no credentials or personal data in fixtures.
- **Fix with:** none
- **Effort:** M

