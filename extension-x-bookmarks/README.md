# X Archive

A small, local Chromium MV3 exporter for X data, rewritten in TypeScript from the
core approach of [sytelus/xarchive](https://github.com/sytelus/xarchive).
No Dexie, React, bundled archive viewer, external account service, or runtime
dependencies beyond the shared Effect 4 already used by this repository.

It does two things:

1. **Bookmarks** — a cumulative archive of your X bookmarks and bookmark folders,
   exported as one JSON file.
2. **Profile posts** — a cumulative archive of *any* profile's entire post history
   (posts, reposts, and replies) as a folder of `posts.json` + media files.

## Context menu

Right-click anywhere on an x.com page to get:

- **Open X archive exporter** — opens the exporter page in a new tab.
- **Collect and download profile posts…** — opens the exporter, collects the last
  visited profile, and downloads the archive folder (posts.json + media) in one
  step. If capture isn't ready the page explains what's missing.
- **Collect and download bookmarks…** — same for the bookmark archive JSON.

The toolbar popup also has the one-click path: visit the profile you want, open
the toolbar icon, and click **Download @handle archive**.

## Use: bookmarks

1. From the repository root, run pnpm install and pnpm run dist.
2. Open chrome://extensions, enable Developer mode, and load
   dist/extension-suite as an unpacked extension.
3. Sign in to X and **reload** [your bookmarks](https://x.com/i/bookmarks).
   The suite service worker passively captures the current GraphQL query ID,
   request features, and X web-app authorization header.
4. Click the suite toolbar icon and choose **Open X archive exporter** (or use
   **All settings**). Select **Collect bookmarks**. Each page is saved locally to
   IndexedDB; retries and throttling handle transient failures and HTTP 429
   responses.
5. To include premium bookmark folders, first open a folder on X as well,
   allowing its GraphQL operation to be captured. The exporter will list
   available folders and scan each one when both operation IDs are present.
6. Select **Download bookmarks JSON**. The account-scoped cumulative archive
   includes the text, author, links, media URLs, quoted posts, and folder
   memberships X returned.

## Use: a profile's entire posts

The exporter can archive the full post history of any profile you can view on X —
original posts, reposts, and replies — as `posts.json` plus the actual media
files (photos and videos). X serves a profile timeline through the same private
GraphQL mechanism as bookmarks, so the same capture-then-paginate strategy
applies; the page scrolls itself, no autoscrolling of the visible tab is
required. Profile requests are captured passively whenever a profile issues
them, and the popup, context menu, and exporter deep link all target the
profile open in the tab you clicked from — so a profile is usable as long as
it has been opened once in this browser. The handle is resolved to X's
numeric user id through the captured `UserByScreenName` lookup request at
collection time; after the first successful run the binding is stored.

1. In a signed-in tab, open the profile, e.g. `https://x.com/jack`, and load:
   - the **Posts** tab (captures `UserTweets` — original posts and reposts), and
   - the **Replies** tab (captures `UserTweetsAndReplies` — additionally the
     replies; X only serves it there). Loading both gives a complete archive.
2. Then either:
   - open the toolbar popup and click **Download @handle archive**, or
   - right-click the page and choose **Collect and download profile posts…**, or
   - open the X archive exporter (toolbar icon → **Open X archive exporter**),
     select **Collect profile posts**, then **Download archive**.

Collection paginates the captured timeline (preferring `UserTweetsAndReplies`,
the superset) into IndexedDB, per account and per target profile. Stop any
time; re-running is safe. The popup and context menu paths collect first, then
export the freshly updated archive automatically.

The export creates a folder `x-profile-<handle>-<date>/` in your downloads:

```
x-profile-jack-2026-11-15/
  posts.json
  media/
    9876543210_0.jpg        first photo of that post
    9876543210_1.mp4        highest-bitrate MP4 variant of that post's video
    1234567890_quoted_0.jpg photo inside a quoted post
    …
```

- Media filenames are `<tweet_id>_<index>.<ext>`; quoted-post media uses
  `<tweet_id>_quoted_<index>.<ext>`. Photos use the original-size rendition
  X serves; videos and animated GIFs use the highest-bitrate `video/mp4` variant.
- `posts.json` is downloaded first; unavailable or failing media files are
  reported at the end, and re-running **Download archive** retries them
  (idempotent overwrite, never duplicated).
- Live progress is shown in the exporter page (bottom-right HUD: posts, pages,
  elapsed, media x/y) and on the toolbar icon as a badge.

## The `posts.json` format (schema_version 1)

```jsonc
{
  "export_metadata": {
    "tool": "x-profile-posts",           // stable tool identifier
    "schema_version": 1,                  // bump when the shape changes
    "kind": "cumulative",                 // reruns merge, they do not snapshot
    "exported_at": "2026-11-15T10:00:00.000Z",
    "user_id": "123",                     // the signed-in account that ran the export
    "profile": {                          // the target profile at scan time
      "user_id": "44196397",
      "screen_name": "jack",
      "name": "jack",
      "profile_image_url": "…",
      "followers_count": 1000,
      "verified": true,
      "description": "…"
    },
    "collection": {
      "posts": "complete",                // complete | partial | not_checked
      "reason": "complete",               // machine-readable outcome of the last run
      "operation": "UserTweetsAndReplies" // which timeline operation was scanned
    },
    "stats": {
      "total_posts": 8123,
      "available_posts": 7990,
      "unavailable_posts": 133,
      "media_items": 3210,                // planned downloads at export time
      "media_missing": 4                  // media entries without a usable URL
    }
  },
  "profile": { /* same object as export_metadata.profile */ },
  "posts": [
    {
      "tweet_id": "1234567890123456789",  // string, snowflake; safe for JS consumers if kept as string
      "sort_index": "1234567890123456789",// X's timeline sort key; posts are newest-first
      "status": "available",              // available | unavailable (tombstone)
      "unavailable_reason": "…",          // only when status is unavailable
      "created_at": "Wed Aug 12 16:12:32 +0000 2026",
      "full_text": "…",                   // note-tweet (longform) text when present
      "lang": "en",
      "source": "<a href=…>X Web</a>",
      "conversation_id": "…",
      "in_reply_to_tweet_id": null,
      "in_reply_to_user_id": null,
      "author": {                         // for a repost, this is the ORIGINAL author
        "user_id": "…", "screen_name": "…", "name": "…",
        "profile_image_url": "…", "verified": true, "followers_count": 0
      },
      "metrics": { "likes": 0, "retweets": 0, "replies": 0, "bookmarks": 0, "views": 0 },
      "entities": { "urls": [ … ], "hashtags": [ … ], "mentions": [ … ] },
      "media": [                          // same shape for photos and videos
        { "type": "photo", "url": "https://pbs.twimg.com/…?format=jpg&name=orig", "alt_text": null },
        { "type": "video", "url": "https://video.twimg.com/…mp4", "thumbnail_url": "…",
          "duration_ms": 12345,
          "variants": [ { "bitrate": 2176000, "content_type": "video/mp4", "url": "…" } ] }
      ],
      "quoted_tweet": null,               // or { tweet_id, full_text, author, media } | { status: "unavailable" }
      "card": null,                       // or { type, url, title, description }
      "repost_of": "…",                   // present on reposts; tweet_id is the repost, this is the original
      "observed_at": "2026-11-15T…Z"      // when the exporter saw this record
    }
  ]
}
```

Notes on stability:

- The per-post schema is the same shape the bookmark archive uses (minus
  `folder_ids`, which is bookmark-only), so tooling written for one can read
  the other. Fields may be added in future schema versions; readers should
  ignore unknown keys.
- A post with `status: "unavailable"` may carry only `tweet_id`; X hides
  tombstoned content. Re-scans merge newer information into earlier records and
  never downgrade an `available` record to a tombstone.
- A repost appears once, keyed by the repost's own `tweet_id`, with
  `repost_of` pointing at the original and `content` (text/media/author) taken
  from the embedded original post. For reposts, `created_at`, `metrics`,
  `entities`, `lang`, `source`, `conversation_id`, `card` and `quoted_tweet`
  all describe the *original* post; the wrapper repost's own timestamp is not
  retained (`sort_index` still reflects X's timeline order).
- Posts are sorted newest-first by `sort_index`, a string; compare with
  `localeCompare`, never as numbers (snowflakes overflow double precision).

Stop and restart safely: page writes are durable, and scans never clear
earlier posts. Scan state is tracked per target profile
(`posts: complete | partial`). A "complete" scan means pagination exhausted on
this run, **not** that X returned every historical post (X may withhold old
content) or that older preserved posts remain visible. Deleted posts and
unavailable posts may contain only IDs. The browser page must remain open for
collection to continue.

## Implementation and security

- Authenticated requests execute from the extension page using the logged-in
  browser session. The suite service worker passively observes X GraphQL
  requests, only when the URL shape is one it recognizes; it records the
  current query IDs, feature flags, an authorization header, and the last
  visited profile's user id — never post content. The popup, the context
  menu (via its page URL), and the exporter deep link target the profile
  in the tab that launched the flow; when only the handle is known, the
  handle is converted to X's numeric user id by replaying the captured
  `UserByScreenName` lookup request, whose response is processed in memory
  and never stored. An extension-scoped DNR rule adds X Origin/Referer
  request headers; a second DNR rule sets a Referer on X's media CDNs
  (`pbs.twimg.com`, `video.twimg.com`) for the extension's own downloads.
- No cookies or authorization headers are written into the archive JSON.
  Captured header information stays in extension-local storage, scoped by the
  numeric session user ID. The CSRF cookie is reread on every request.
- The GraphQL endpoints are **private and unstable**; X can change paths,
  flags, authorization, cursors, response layouts, or rate limits at any time.
  Malformed responses and pagination loops are reported as partial.
- A subsequent scan merges new information into existing records. Existing
  available content is preserved if a later page only contains a tombstone.
- Data is stored in native IndexedDB, separately per X account:
  `x-bookmarks-<account>` for bookmarks, `x-profile-<account>` for profile
  posts (keyed by account + target profile, with a per-target scan state).
- Media downloads go through `chrome.downloads` directly from the remote URL
  (no host permission for the CDN is needed); `posts.json` is saved before
  media so the manifest is never blocked by a media failure.
- Source inspiration: [xarchive](https://github.com/sytelus/xarchive),
  copyright its respective authors, MIT license. This port is an independent
  reduced implementation, not a drop-in replacement for xarchive's viewer,
  reconciliation, import, and undo features.

## Troubleshooting

**Every button is greyed out.** The exporter can only see the cookies of the
browser it is installed in. If you use x.com in a different browser than the one
carrying the extension, everything below **Refresh connection** stays disabled —
sign in to x.com in *that* browser first. Each disabled button also carries a
tooltip explaining exactly what it needs. The suite popup is a faster path:
page icon → **Open X archive exporter**, or right-click any x.com page → the
context menu entries above.

**"Visit a profile on x.com first" even though the profile is open.** The popup
targets the profile in the active x.com tab, so make sure that tab is the
profile — token URLs like `https://x.com/jack`, `…/jack/with_replies`,
`…/jack/media` all work; a whole post page (`…/jack/status/123`) does not. If
the exporter then reports the lookup request was never captured, the extension
has not seen any request from x.com in this browser since it was reloaded —
reload the profile page once and try again. The exporter's **Capture log** line
shows the last request the extension captured and when; "None yet" means no
request has been captured at all, which is the symptom of a stale tab or a
browser restart wiping the extension's memory — a reload fixes both.

**"X could not resolve @handle to a user id."** Reload the profile page once;
if it persists, report it — X changed its lookup response shape.

**"X changed its timeline response. Partial results were preserved."** X changed
its private GraphQL shape or served something unexpected; the posts captured so
far are kept. Reload and try again; if it persists, report the shape drift.

## Development

pnpm run check runs strict typechecking and unit tests. pnpm run dist
builds the unified extension. extension-x-bookmarks/test covers response
parsing, account safety, credential capture, merging, profile-timeline parsing
(including reposts and quoted media), media planning and download tracking.
