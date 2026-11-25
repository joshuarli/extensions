Prefix: EXT
Next: 46

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-25 · P1 · Publish a versioned, restorable extension release

- **Area:** Release / operations
- **Where:** .github/workflows/ci.yml:18-71; extension-suite/src/identity.ts:3; README.md:17-23
- **Problem:** The shipped version is a literal in source, no workflow packages or retains dist/extension-suite, and README.md tells users to obtain a folder from a person; a bad release cannot be identified or restored without rebuilding an old commit.
- **Recommendation:** Stamp the release tag into the generated identity module, build and retain each published folder with its tag and commit, and document the restore path.
- **Fix with:** none
- **Effort:** M
- **Design:** docs/rfc/EXT-25-release-artifact.md

### EXT-26 · P1 · Remove real X discovery finds from the public repository

- **Area:** X discovery / privacy
- **Where:** docs/x-discover/movies/finds.jsonl:1-17; docs/x-discover/README.md:15,32; TODO.md:36
- **Problem:** The committed ledger exposes 17 real third-party handles, author IDs, tweet IDs, post text, resource links and follow timestamps; the README calls it the durable record and normal track and follow runs append more.
- **Recommendation:** Replace it with synthetic fixtures, ignore real ledgers, move the durable record to local state, and get the owner's decision on a history purge.
- **Fix with:** none
- **Effort:** M
- **Design:** docs/rfc/EXT-26-discovery-ledger-privacy.md

### EXT-30 · P2 · Credentialed media fetches accept URLs from archived data

- **Area:** X / Instagram archive / security
- **Where:** x-archive-cli/src/media.ts:77-81; lib/x-session.ts:61-66; x-archive-core/src/media.ts:69-95; instagram-client-core/src/client.ts:424-430
- **Problem:** Media URLs come from archived posts and manifests and are fetched with the full cookie header and no host allowlist; an attacker-controlled URL would exfiltrate the session. Parked: no reachable attacker-controlled URL source was proven, and an allowlist could drop legitimate CDN hosts. Unblock by proving a live X or Instagram response can supply an off-host media URL, then enumerate the exact host set.
- **Recommendation:** Allowlist media hosts before attaching cookies, record rejected URLs as failures, and prove a reachable input source with a fixture first.
- **Fix with:** security
- **Effort:** S

### EXT-41 · P3 · ChatGPT archive completeness is sticky and early stop checks one page

- **Area:** ChatGPT archive / durable state
- **Where:** chatgpt-archive-cli/src/download.ts:102-105,200-208; chatgpt-archive-core/src/index.ts:84
- **Problem:** complete is never reset and listScope stops when the first page is fully covered, so a chat updated later outside that page can stay unarchived. Parked: the live ordering sequence that produces this is unproven. Unblock with a fixture that marks the scope complete, then adds an unarchived chat outside the first page and shows it missing from a later export.
- **Recommendation:** Require a full enumeration before marking or keeping complete, and clear complete on partial or stopped runs; prove the ordering case with a fixture.
- **Fix with:** durable-state
- **Effort:** M

### EXT-9 · P4 · Qualify live X and YouTube service boundaries

- **Area:** Service integration
- **Where:** x-archive-core/test/api.test.ts; extension-youtube-transcript/test/http.test.ts; extension-youtube-transcript/test/integration.test.ts
- **Problem:** Service tests use fixtures or mocks, leaving compatibility with live X and YouTube endpoints unverified.
- **Recommendation:** Define and run an owner-authorized live qualification using suitable accounts and retain no credentials or personal data in fixtures.
- **Fix with:** none
- **Effort:** M

