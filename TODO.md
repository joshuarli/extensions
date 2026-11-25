Prefix: EXT
Next: 25

### EXT-1 · P1 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** Needs owner · authorize a live bctl run with everyday Helium closed and define the unattended interval
- **Where:** x-archive-cli/src/backend.ts, x-archive-cli/src/deps.ts, ~/repos/bctl (graphical profile login and CDP gateway); docs/EXT-1-bctl-qualification.md
- **Problem:** A complete `x download self --backend=bctl` run passed on 2026-11-17 with bctl release-2b858053: the test account signed in headed to the shared shadowdriver-ig guest profile, persisted across a headless restart, and exported bookmarks (folder query not captured) and likes (complete). Unattended reliability and a run with everyday Helium closed remain unproven. See the qualification record. 2026-11-21 re-check: the bctl seam and its planning/cache tests are intact and no offline defect reproduces; closing needs owner-performed real-account acceptance recorded in docs/EXT-1-bctl-qualification.md.
- **Recommendation:** Qualify the repaired browser and actual X login page first, then have the owner sign into the dedicated xarchive guest profile, flush/restart it, and run the real archive through bctl with everyday Helium closed. Reuse the existing 30-day captured-credential cache; keep GraphQL/media host-HTTPS and the no-extension path. Record a complete run and an unattended interval honestly; a short pilot does not establish overnight acceptance.
- **Fix with:** none
- **Effort:** M

### EXT-12 · P1 · Preserve raw X tweet payloads and stop schema-decode field loss

- **Area:** X archive · collection and storage
- **Where:** x-archive-core/src/parser.ts:113-230, merge.ts:25, storage.ts:86/130/176/216; x-archive-cli/src/fs-store.ts:60/115, profile-db.ts:95/124/132/154
- **Problem:** The normalized Bookmark is the only persisted record and Effect decodeUnknownSync strips undeclared keys at every hop, so card bindings, note-tweet entities, reposter identity and future fields are discarded at collection and cannot be recovered without re-fetching a post X may have deleted.
- **Recommendation:** Store the raw tweet result beside each record in a separate SQLite column and JSON field outside BookmarkSchema, bump schema_version with a re-derivation path, and generate the renderer's normalized view from it.
- **Fix with:** architect
- **Effort:** L

### EXT-13 · P1 · Record media download outcomes and stop emitting broken HTML media links

- **Area:** X archive · media and HTML export
- **Where:** x-archive-core/src/media.ts:75-96, render.ts:153-203, export-types.ts:8-14; x-archive-cli/src/media.ts:174-200, run.ts:179-181
- **Problem:** Rendered src paths are recomputed from URL conventions instead of downloaded files; skipped or failed media (common under the 16 MB default) becomes a broken link with no marker, .jpeg URLs produce a .jpg download but a .jpeg link, and the lightbox only cycles the four anchors renderMedia emits.
- **Recommendation:** Write a per-export media manifest (filename, source URL, bytes, sha256, status and reason) into the JSON, have renderArchive read it rather than recompute paths, emit explicit unavailable placeholders, and render every gallery item.
- **Fix with:** single-source-of-truth
- **Effort:** M

### EXT-4 · P2 · Port the Instagram archiver here as instagram-archive-core and instagram-archive-cli — done

- **Area:** Instagram archive
- **Where:** new instagram-archive-core/ and instagram-archive-cli/ (shape: x-archive-core, x-archive-cli); reference implementation ~/repos/shadowdriver/ig (Python, the parity oracle) and ~/repos/shadowdriver/ig-ts (frozen TS prototype, raw material); session pattern: x-archive-cli/src/deps.ts and x-archive-core/src/session.ts
- **Problem:** Owner decision 2026-11-22: IG leaves Shadowdriver and becomes a terminal archiver in this repository, reading the logged-in session over CDP from Helium or a bctl appliance (--backend=bctl) the way x-archive-cli does, without stealth scripts. Shadowdriver keeps only Grab, and its IG, ig-ts and Node SDK trees are deleted once this port reaches parity (SHD-51). The hard part is media fidelity: HQ video and separate audio tracks currently come from CDP response-body capture and an ffmpeg mux.
- **Recommendation:** Gate 1, a one-to-two-day spike: a collector on the x-archive session pattern, checked against Python ig on a fixed set of 20 to 30 posts (a profile needing more than one page, a saved collection, image and mixed carousels, reels with audio, one HQ video). Compare post identity, membership, carousel order, dimensions, audio presence and duration. Any silent loss fails the spike. Gate 2: port saved and profile membership, resumable downloads, completion checks, the ffmpeg mux and the static gallery, reusing x-archive-core merge, storage and render patterns. Carry Shadowdriver SHD-49: any rate limit, login redirect, checkpoint or unrecognized response parks the whole job with its reason across restarts until a deliberate resume. Use synthetic fixtures only: this repository is public and the IG tree holds personal archive files. Add a suite feature only if passive credential capture is needed, following extension-x-archive.
- **Fix with:** reference-parity
- **Effort:** L

### EXT-14 · P2 · Normalize quoted posts, cards and repost authors with full fidelity

- **Area:** X archive · parsing and HTML export
- **Where:** x-archive-core/src/parser.ts:142-171, 173-179, 221-226; render.ts:209-247
- **Problem:** Quoted tweets are stored without created_at, metrics or entities, so every quote card renders unknown date and zero metrics with no links; card and poll bindings are parsed but never rendered; repost attribution uses the original author's name, so the reposter is discarded and the banner is wrong.
- **Recommendation:** Run quoted posts through the same normalizer as top-level posts, render the parsed card and poll data, and keep the reposting author distinct from the original author in the record.
- **Fix with:** none
- **Effort:** M

### EXT-15 · P2 · Preserve bookmark and likes order in archive.html

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/storage.ts:96/133/179; render.ts:396-403
- **Problem:** Exports are sorted by sort_index, the user's save order, but renderArchive re-sorts every post by created_at, so the page silently loses the ordering that matters most in a bookmarks or likes archive and disagrees with posts.json.
- **Recommendation:** Render in the order the export supplies, applying the created_at sort only where it is the documented order.
- **Fix with:** none
- **Effort:** S

### EXT-16 · P2 · Show collection completeness and media failures in the exported page

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/storage.ts:105-109/143-145/199-203, debug.ts:81-111; render.ts:393/407-414/449-453
- **Problem:** Collection coverage, reason codes and media failed/skipped lists are computed and stored but never read by the renderer, so a rate-limited partial archive looks identical to a complete one and missing media is invisible in the page.
- **Recommendation:** Add a completeness line to the header or footer from export_metadata.collection and the media result, with an explicit note when coverage is partial or media is missing.
- **Fix with:** none
- **Effort:** S

### EXT-17 · P2 · Make --export-only offline and reproducible

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/render.ts:285-342; x-archive-cli/src/run.ts:211, args.ts:32
- **Problem:** Rendering fetches the profile photo and scrapes the banner from live x.com at export time and no CLI flag disables it, because renderArchive's noFetch option is never wired, so re-exporting saved data makes network calls and is not byte-reproducible.
- **Recommendation:** Capture profile image and banner into media/ during collection, record them in the JSON, render only from local files, and add an offline guard that fails instead of fetching.
- **Fix with:** isolate-effects
- **Effort:** M

### EXT-18 · P2 · Stop inferring profile identity from post authors

- **Area:** X archive · HTML export
- **Where:** x-archive-core/src/render.ts:368-381, 308-340; storage.ts:181-199
- **Problem:** When the exported profile lacks a handle or name renderArchive adopts the most frequent post author; on a repost-heavy profile that is a different account and the renderer then fetches that person's banner, misattributing the archive.
- **Recommendation:** Use the known target user id and handle carried in export_metadata or the requested profile recorded by the CLI, and fall back to a neutral label instead of a donor post.
- **Fix with:** none
- **Effort:** S

### EXT-19 · P2 · Preserve metric provenance in cumulative archives

- **Area:** X archive · collection and storage
- **Where:** x-archive-core/src/parser.ts:46-52/198/205; merge.ts:14-23
- **Problem:** Missing numeric fields become zero and merges overwrite earlier metrics with newer zero snapshots; observed_at is replaced on every observation and no first_seen_at is kept, so the archive cannot distinguish absent from zero or recover its history.
- **Recommendation:** Make metrics nullable per field, keep first_seen_at, do not overwrite a known value with an absent one, and label HTML counts as observed-at values.
- **Fix with:** make-invalid-states-unrepresentable
- **Effort:** M

### EXT-20 · P2 · Add an end-to-end export contract test

- **Area:** X archive · tests
- **Where:** x-archive-core/test/render.test.ts:10-46; x-archive-cli/test/cli-process.test.ts:173-200
- **Problem:** The only render test checks a date, a mention span and script absence, and the CLI process test checks two JSON fields and that the HTML contains post text; quote fidelity, media links, order, cards, folders, unavailable items and deterministic offline re-export are unasserted.
- **Recommendation:** Add fixture-driven assertions over generated JSON, media/ and archive.html: every referenced src exists or has an explicit unavailable marker, quotes and cards round-trip, order matches the export, profile identity is correct, and two offline renders are byte-identical.
- **Fix with:** none
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

### EXT-9 · P4 · Qualify live X and YouTube service boundaries

- **Area:** Service integration
- **Where:** x-archive-core/test/api.test.ts; extension-youtube-transcript/test/http.test.ts; extension-youtube-transcript/test/integration.test.ts
- **Problem:** Service tests use fixtures or mocks, leaving compatibility with live X and YouTube endpoints unverified.
- **Recommendation:** Define and run an owner-authorized live qualification using suitable accounts and retain no credentials or personal data in fixtures.
- **Fix with:** none
- **Effort:** M

