# Dead-code scan dispositions

Base `160f9b7`: Knip 6.45.1 default mode reported 22 value-export file groups, 17 type-export file groups, and one duplicate group. The table accounts for every named item. The root package is private; no package exports map exposes these source modules. Searches included all tracked source, tests, scripts, docs, manifests, Vite entries, dynamic imports and script injection. Each name was searched independently; same-name members in other modules were distinguished from imports of the reported module. The table describes the reported declaration, not similarly named live code.

Vite entries are in `vite.config.ts`; HTML entry scripts, suite worker, injected classic scripts, both CLI entry points, tests and the crash child are entries in `scripts/knip.json`. `chrome.scripting.executeScript` serializes functions or loads explicit Vite bundles, not these unused exports. Node and Chromium are supported shapes. No messages, stored field names, CLI flags or formats changed. No allowlist was required.

| Reported module | Finding and disposition |
| --- | --- |
| `extension-allow-right-click/src/background.ts` | `isArcRuntimeRequest` — private: used only in defining module; `executeCore` — private: used only in defining module; `readArcStatus` — private: used only in defining module |
| `extension-onefile/src/filename.ts` | `sanitizeTitleForFilename` — private: used only in defining module |
| `extension-x-bookmarks/src/api.ts` | `DEFAULT_FIELD_TOGGLES` — removed unused re-export; underlying definition retained; `FailureKind` — removed unused re-export; underlying definition retained; `XSession` — removed unused re-export; underlying definition retained |
| `extension-x-bookmarks/src/archive-engine.ts` | `STALE_RUN_MS` — private: used only in defining module; `runHeartbeatIsStale` — private: used only in defining module |
| `extension-x-bookmarks/src/archive-run.ts` | `archiveStopKey` — private: used only in defining module; `ArchiveRunPhase` — private: used only in defining module |
| `extension-x-bookmarks/src/background.ts` | `xProfileLastCaptureKey` — private: used only in defining module; `xProfileUnmatchedOpsKey` — private: used only in defining module |
| `extension-x-bookmarks/src/collector.ts` | `collectProfileTimeline` — removed unused re-export; underlying definition retained; `ArchiveDeps` — removed unused re-export; underlying definition retained; `BookmarksStore` — removed unused re-export; underlying definition retained; `LikesStore` — removed unused re-export; underlying definition retained; `ProfileStore` — removed unused re-export; underlying definition retained; `CollectionOptions` — removed unused re-export; underlying definition retained; `ProgressSnapshot` — removed unused re-export; underlying definition retained |
| `extension-x-bookmarks/src/debug.ts` | `statusLogKey` — private: used only in defining module; `lastErrorKey` — private: used only in defining module; `buildCoreDebugReport` — removed unused re-export; underlying definition retained; `DebugReport` — removed unused re-export; underlying definition retained; `DebugGathered` — removed unused re-export; underlying definition retained |
| `extension-x-bookmarks/src/likes-storage.ts` | `saveLikesPage` — private: used only in defining module; `saveLikesState` — private: used only in defining module |
| `extension-x-bookmarks/src/profile-storage.ts` | `PROFILE_POSTS_STORE` — private: used only in defining module; `PROFILE_STATE_STORE` — private: used only in defining module; `profilePostCount` — private: used only in defining module; `ProfileScanProfile` — removed unused re-export; underlying definition retained |
| `extension-x-bookmarks/src/storage.ts` | `assembleLikesArchive` — removed unused re-export; underlying definition retained; `savePage` — private: used only in defining module; `saveFolders` — private: used only in defining module; `saveState` — private: used only in defining module; `Coverage` — removed unused re-export; underlying definition retained; `LikesScanState` — removed unused re-export; underlying definition retained; `ProfileScanState` — removed unused re-export; underlying definition retained |
| `extension-youtube-transcript/src/srt.ts` | `formatSrtTimestamp` — private: used only in defining module |
| `extension-youtube-transcript/src/types.ts` | `CaptionTrackSchema` — private: used only in defining module; `AudioTrackSchema` — private: used only in defining module; `TranscriptSegmentSchema` — private: used only in defining module; `ChapterSchema` — private: used only in defining module; `TranscriptResultSchema` — private: used only in defining module; `PageMetadataSchema` — private: used only in defining module; `FetchMock` — deleted: no consumer or local use |
| `extension-youtube-transcript/src/youtube-api.ts` | `YouTubeHttpClient` — private: used only in defining module; `fetchCaptionXml` — private: used only in defining module; `fetchChapters` — private: used only in defining module |
| `x-archive-cli/src/backend.ts` | `DEFAULT_CDP_URL` — private: used only in defining module; `BackendKind` — private: used only in defining module |
| `x-archive-cli/src/profile-db.ts` | `PROFILE_DB_NAME` — private: used only in defining module |
| `x-archive-cli/src/run.ts` | `downloadBookmarks` — private: used only in defining module; `downloadLikes` — private: used only in defining module |
| `x-archive-core/src/api.ts` | `DEFAULT_FIELD_TOGGLES` — private: used only in defining module |
| `x-archive-core/src/capture.ts` | `BOOKMARK_OPERATIONS` — private: used only in defining module; `LIKES_OPERATIONS` — private: used only in defining module; `LOOKUP_OPERATIONS` — private: used only in defining module; `OPERATIONS` — private: used only in defining module |
| `x-archive-core/src/collector.ts` | `collectProfileTimeline` — private: used only in defining module; `ProgressSnapshot` — private: used only in defining module |
| `x-archive-core/src/parser.ts` | `parseProfileInfo` — private: used only in defining module |
| `x-archive-core/src/storage.ts` | `ProfileScanProfileSchema` — private: used only in defining module; `sortPostsBySortIndex` — deleted: no consumer or local use; `Coverage` — private: used only in defining module |
| `extension-onefile/src/background.ts` | `OnefileActionState` — private: used only in defining module |
| `extension-onefile/src/polyglot.ts` | `PolyglotMetadata` — private: used only in defining module |
| `extension-onefile/src/zip.ts` | `ZipEntry` — private: used only in defining module |
| `extension-suite/src/action-status.ts` | `ActionFeature` — private: used only in defining module; `FeatureActionState` — private: used only in defining module |
| `x-archive-cli/src/seed.ts` | `SeedCounts` — private: used only in defining module |
| `x-archive-core/src/media.ts` | `MediaKind` — private: used only in defining module |
| `x-archive-core/src/session.ts` | `XSession` — private: used only in defining module |
| `extension-suite/src/identity.ts` | `suiteName` — duplicate: manifest and worker use suiteName directly; `suiteActionTitle` — duplicate: manifest and worker use suiteName directly |

After the listed re-export removals, `FailureKind`, `CollectionOptions`, `ProgressSnapshot`, `XSession` and `Coverage` in core became private as well; their in-module users remain. The profile-state and diagnostic storage keys retain their literal values. The duplicate `suiteActionTitle` was an alias of `suiteName`: manifest and worker now read `suiteName` directly, preserving the actual title. The deleted sort helper had no caller; the separate archive sorts remain. The removed source `FetchMock` type had no consumer; the integration test declares its own unrelated type.

Structural review: the suite owns listener registration and the Vite entry set; feature handlers, captured-request schemas, account-scoped stores, page checkpoints and Onefile archive/loader remain connected to their user flows. The indexed state and recovery mechanisms are retained because their tests and documented restart/export paths consume them; no public behavior was identified for a walk-back. The Knip run is static evidence within this repository, not proof about undocumented external imports. No dependencies, CI or browser permissions changed.

Reproduce with `TMPDIR=$PWD/.work/tmp npm_config_registry=https://npm.17166969.xyz/current pnpm dlx knip@6.45.1 --config scripts/knip.json` and repeat with `--production`. Both modes returned exit 0 after the changes. The tool is a temporary runner; package.json and lockfile are unchanged.
