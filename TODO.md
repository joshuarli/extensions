Prefix: EXT
Next: 45

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-13 · P1 · Record media download outcomes and stop emitting broken HTML media links

- **Area:** X archive · media and HTML export
- **Where:** x-archive-core/src/media.ts:75-96, render.ts:153-203, export-types.ts:8-14; x-archive-cli/src/media.ts:174-200, run.ts:179-181
- **Problem:** Rendered src paths are recomputed from URL conventions instead of downloaded files; skipped or failed media (common under the 16 MB default) becomes a broken link with no marker, .jpeg URLs produce a .jpg download but a .jpeg link, and the lightbox only cycles the four anchors renderMedia emits.
- **Recommendation:** Write a per-export media manifest (filename, source URL, bytes, sha256, status and reason) into the JSON, have renderArchive read it rather than recompute paths, emit explicit unavailable placeholders, and render every gallery item.
- **Fix with:** single-source-of-truth
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

### EXT-20 · P2 · Add an end-to-end export contract test

- **Area:** X archive · tests
- **Where:** x-archive-core/test/render.test.ts:10-46; x-archive-cli/test/cli-process.test.ts:173-200
- **Problem:** The only render test checks a date, a mention span and script absence, and the CLI process test checks two JSON fields and that the HTML contains post text; quote fidelity, media links, order, cards, folders, unavailable items and deterministic offline re-export are unasserted.
- **Recommendation:** Add fixture-driven assertions over generated JSON, media/ and archive.html: every referenced src exists or has an explicit unavailable marker, quotes and cards round-trip, order matches the export, profile identity is correct, and two offline renders are byte-identical.
- **Fix with:** none
- **Effort:** M

### EXT-29 · P2 · Browser CI failures leave no diagnostic artifacts

- **Area:** CI / operability
- **Where:** .github/workflows/ci.yml:63-71; extension-onefile/playwright.config.ts:6-8; extension-chatgpt/playwright.config.ts:5-7
- **Problem:** Playwright retries are zero, the reporter is line, and output goes to .work/tmp on an ephemeral runner with no upload step, so a failed run leaves no screenshots or traces to inspect.
- **Recommendation:** Upload the Playwright output directories from failing installed-browser steps.
- **Fix with:** none
- **Effort:** S

### EXT-30 · P2 · Credentialed media fetches accept URLs from archived data

- **Area:** X / Instagram archive / security
- **Where:** x-archive-cli/src/media.ts:77-81; lib/x-session.ts:61-66; x-archive-core/src/media.ts:69-95; instagram-client-core/src/client.ts:424-430
- **Problem:** Media URLs come from archived posts and manifests and are fetched with the full cookie header and no host allowlist; an attacker-controlled URL would exfiltrate the session. Reachability from a live X or Instagram response is unproven.
- **Recommendation:** Allowlist media hosts before attaching cookies, record rejected URLs as failures, and prove a reachable input source with a fixture first.
- **Fix with:** security
- **Effort:** S

### EXT-31 · P2 · X self export exits successfully when requested outputs fail

- **Area:** X archive / error model
- **Where:** x-archive-cli/src/run.ts:206-217,353-362,446-455,479-482; x-archive-cli/src/main.ts:87-94
- **Problem:** Render, social and seeding failures are only appended to an in-memory status log after debug.json is written, and main returns zero, so a partial archive looks complete.
- **Recommendation:** Carry requested-output failures in RunSummary, include them in debug.json, and return a degraded status or non-zero exit.
- **Fix with:** error-model
- **Effort:** S

### EXT-32 · P2 · Concurrent X archive writers lose records

- **Area:** X archive / durable state
- **Where:** x-archive-cli/src/fs-store.ts:55-67,110-122; x-archive-cli/src/state.ts:36-55; docs/development.md:34
- **Problem:** Each save reloads the whole JSON, merges and renames a PID-suffixed temp file with no lock or version check, so two overlapping runs overwrite each other's pages.
- **Recommendation:** Serialize writers with an exclusive lock or make record storage append-only with idempotent merge on load.
- **Fix with:** durable-state
- **Effort:** M

### EXT-21 · P3 · Render parsed fields that the HTML currently ignores

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/storage.ts:93-95; parser.ts:197/207-217; render.ts:132-146/269-273
- **Problem:** Folder names are added to the JSON but never displayed; verified, source, in_reply_to_user_id and structured mention/hashtag entities are parsed but unused because linkify voids the latter and regexes the text, and expanded URLs are truncated to 60 characters.
- **Recommendation:** Add folder chips, a verified badge, source and reply-to info, and entity-offset-driven mention and hashtag links using display_url.
- **Fix with:** none
- **Effort:** S

### EXT-22 · P3 · Fix thread ordering across archived and context posts

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/conversation.ts:168; render-assets.ts:15 (THREAD_HTML); render.ts:241-243
- **Problem:** The thread overlay sorts every article of a conversation by data-sort-index, but archived posts carry a timeline index while context posts carry their tweet id as sort_index, so reconstructed threads can render out of order.
- **Recommendation:** Store a consistent chronological key on both record kinds, created_at epoch where available, and sort the overlay by it.
- **Fix with:** none
- **Effort:** S

### EXT-23 · P3 · Label context posts and report thread-context gaps

- **Area:** X archive · collection and HTML export
- **Where:** x-archive-core/src/conversation.ts:148-199; x-archive-cli/src/context.ts:83-197; render.ts:444-449
- **Problem:** Context ancestors are intentionally text-only with media, quotes and cards nulled but the thread viewer says fully offline, and failed or unreachable context pages appear only in status_log, so partial thread reconstruction cannot be distinguished in the export.
- **Recommendation:** Add context_failed and context_unreachable counts to export_metadata.stats and mark context posts as text-only in the page.
- **Fix with:** none
- **Effort:** S

### EXT-24 · P3 · Seed legacy archives by content rather than record count

- **Area:** X archive · migration
- **Where:** x-archive-cli/src/seed.ts:237/253/275
- **Problem:** Legacy IndexedDB archives are merged only when they have more records than the CLI store, so a smaller but richer legacy archive is silently ignored and a larger but stale one wins.
- **Recommendation:** Merge by tweet id with the existing mergeBookmark semantics and report added and updated counts instead of comparing totals.
- **Fix with:** none
- **Effort:** M

### EXT-37 · P3 · X capture operation sets are duplicated between core and CLI

- **Area:** X archive / credential capture
- **Where:** x-archive-core/src/capture.ts:5-8; x-archive-cli/src/deps.ts:66-68
- **Problem:** Bookmark and likes operation tuples are private to capture.ts and re-listed verbatim in deps.ts; a rename missed in the router leaves the operation uncapturable with a misleading remedy.
- **Recommendation:** Export the tuples or membership helpers from capture.ts, derive the CLI sets from them, and test that every operation group maps to a capture page.
- **Fix with:** single-source-of-truth
- **Effort:** S

### EXT-41 · P3 · ChatGPT archive completeness is sticky and early stop checks one page

- **Area:** ChatGPT archive / durable state
- **Where:** chatgpt-archive-cli/src/download.ts:102-105,200-208; chatgpt-archive-core/src/index.ts:84
- **Problem:** complete is never reset and listScope stops when the first page is fully covered, so a chat updated later outside that page can stay unarchived; whether live ordering produces this is unproven.
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

