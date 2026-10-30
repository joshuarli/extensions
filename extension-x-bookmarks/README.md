# X Bookmarks

A small, local Chromium MV3 bookmark exporter, rewritten in TypeScript from the
core approach of [sytelus/xarchive](https://github.com/sytelus/xarchive).
No Dexie, React, bundled archive viewer, external account service, or runtime
dependencies beyond the shared Effect 4 already used by this repository.

## Use

1. From the repository root, run pnpm install and pnpm run dist.
2. Open chrome://extensions, enable Developer mode, and load
   dist/extension-x-bookmarks as an unpacked extension.
3. Sign in to X and **reload** [your bookmarks](https://x.com/i/bookmarks).
   The service worker passively captures the current GraphQL query ID,
   request features, and X web-app authorization header.
4. Click the X Bookmarks extension icon to open its page and select
   **Collect all**. Each page is saved locally to IndexedDB; retries and
   throttling handle transient failures and HTTP 429 responses.
5. To include premium bookmark folders, first open a folder on X as well,
   allowing its GraphQL operation to be captured. The exporter will list
   available folders and scan each one when both operation IDs are present.
6. Select **Download JSON**. The account-scoped cumulative archive includes
   the text, author, links, media URLs, quoted posts, and folder memberships
   X returned. No actual media files are downloaded.

Stop and restart safely: page writes are durable, and scans never clear
earlier posts. The export marks main-timeline and folder coverage separately.
A "complete" scan means pagination exhausted on this run, **not** that X
returned every historical bookmark or that older preserved posts remain
currently bookmarked. Deleted posts and unavailable posts may contain only IDs.
The browser page must remain open for collection to continue.

## Implementation and security

- Authenticated requests execute from the extension page using the logged-in
  browser session. The service worker observes only X bookmark GraphQL requests,
  and an extension-scoped DNR rule adds X Origin/Referer request headers.
- No cookies or authorization headers are written into archive JSON. Captured
  header information stays in extension-local storage, scoped by the numeric
  session user ID. The CSRF cookie is reread on every request.
- The GraphQL endpoints are **private and unstable**; X can change paths,
  flags, authorization, cursors, response layouts, or rate limits at any time.
  Malformed responses and pagination loops are reported as partial.
- A subsequent scan merges new information into existing records. Existing
  available content is preserved if a later page only contains a tombstone.
- Data is stored in native IndexedDB, separately for each X account.
- Source inspiration: [xarchive](https://github.com/sytelus/xarchive),
  copyright its respective authors, MIT license. This port is an independent
  reduced implementation, not a drop-in replacement for xarchive's viewer,
  reconciliation, import, and undo features.

## Development

pnpm run check runs strict typechecking and unit tests. pnpm run dist
builds all four Chromium extensions. extension-x-bookmarks/test covers
response parsing, account safety, credential capture, and merging.
