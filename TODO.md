Prefix: EXT
Next: 4

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

