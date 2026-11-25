Prefix: EXT
Next: 12

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-4 · P2 · Port the Instagram archiver here as instagram-archive-core and instagram-archive-cli — done

- **Status:** Implemented 2026-11-25 as `instagram-client-core`, `instagram-archive-core`, and `instagram-archive-cli` on branch `ext4-sdk`. The client owns the CDP session, account guard, live `PolarisProfilePostsQuery` capture, typed parking failures, and operation recipes; the core owns parsing, media selection, checkpoints, and site rendering; the CLI owns scan, get, update, build, info, following, and durable job parking. Live CDP validation covered query capture, 12-post parsing, image and video downloads, saved collection resolution, and site build. Two differences from the Python oracle are recorded: the v1 media-info endpoint is no longer served, so HQ DASH falls back to the standard URL; `follow` and `get-post` are not available in this port.
- **Area:** Instagram archive
- **Where:** new instagram-archive-core/ and instagram-archive-cli/ (shape: x-archive-core, x-archive-cli); reference implementation ~/repos/shadowdriver/ig (Python, the parity oracle) and ~/repos/shadowdriver/ig-ts (frozen TS prototype, raw material); session pattern: x-archive-cli/src/deps.ts and x-archive-core/src/session.ts
- **Problem:** Owner decision 2026-11-22: IG leaves Shadowdriver and becomes a terminal archiver in this repository, reading the logged-in session over CDP from Helium or a bctl appliance (--backend=bctl) the way x-archive-cli does, without stealth scripts. Shadowdriver keeps only Grab, and its IG, ig-ts and Node SDK trees are deleted once this port reaches parity (SHD-51). The hard part is media fidelity: HQ video and separate audio tracks currently come from CDP response-body capture and an ffmpeg mux.
- **Recommendation:** Gate 1, a one-to-two-day spike: a collector on the x-archive session pattern, checked against Python ig on a fixed set of 20 to 30 posts (a profile needing more than one page, a saved collection, image and mixed carousels, reels with audio, one HQ video). Compare post identity, membership, carousel order, dimensions, audio presence and duration. Any silent loss fails the spike. Gate 2: port saved and profile membership, resumable downloads, completion checks, the ffmpeg mux and the static gallery, reusing x-archive-core merge, storage and render patterns. Carry Shadowdriver SHD-49: any rate limit, login redirect, checkpoint or unrecognized response parks the whole job with its reason across restarts until a deliberate resume. Use synthetic fixtures only: this repository is public and the IG tree holds personal archive files. Add a suite feature only if passive credential capture is needed, following extension-x-archive.
- **Fix with:** reference-parity
- **Effort:** L

### EXT-9 · P4 · Qualify live X and YouTube service boundaries

- **Area:** Service integration
- **Where:** x-archive-core/test/api.test.ts; extension-youtube-transcript/test/http.test.ts; extension-youtube-transcript/test/integration.test.ts
- **Problem:** Service tests use fixtures or mocks, leaving compatibility with live X and YouTube endpoints unverified.
- **Recommendation:** Define and run an owner-authorized live qualification using suitable accounts and retain no credentials or personal data in fixtures.
- **Fix with:** none
- **Effort:** M

