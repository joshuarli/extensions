Prefix: EXT
Next: 2

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** x-archive-cli
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** The bctl backend seam is implemented, but real persistent X sign-in, one complete `x download self --backend=bctl`, and unattended reliability remain unproven. The owner made completion a priority on 2026-11-16. The new headed macOS release passes display/input/persistence fixtures, but the old browser crashes on Instagram and an X login probe hits a kernel frame failure; real account qualification remains blocked. See the qualification record for current evidence and limits.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M
