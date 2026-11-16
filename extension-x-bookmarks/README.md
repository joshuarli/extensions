# X Archive

A small, local Chromium MV3 exporter for X data, rewritten in TypeScript from the
core approach of [sytelus/xarchive](https://github.com/sytelus/xarchive).
No Dexie, React, bundled archive viewer, external account service, or runtime
dependencies beyond the shared Effect 4 already used by this repository.

It does two things:

1. **Bookmarks** — a cumulative archive of your X bookmarks and bookmark folders,
   exported as a folder (`bookmarks.json` + media files + `debug.json`).
2. **Profile posts** — a cumulative archive of *any* profile's entire post history
   (posts, reposts, and replies) as a folder of `posts.json` + media files.

## One place: the toolbar popup

Everything lives in the toolbar popup — click the suite icon on any page. No
separate page opens, so nothing depends on a tab staying alive: the archive
engine runs in the extension's service worker, and clicking anywhere (or
closing the popup) cannot stop a run in flight. Progress (posts, pages,
media count) is shown inline with a progress bar and a **Stop** button; the
toolbar badge mirrors the state (blue working, green done, red failed). Each
run records to local storage, so the popup always shows the current or last
run even after being closed and reopened.

## Context menu

Right-click anywhere on an x.com page to get:

- **Collect and download profile posts…** — collects the profile open in the
  tab you right-clicked and downloads the archive folder (posts.json +
  media) in one step; works without opening anything.
- **Collect and download bookmarks…** — same one-click step for your
  bookmarks: `bookmarks-<date>/` with `bookmarks.json`, the actual media
  files, and a `debug.json`.

The toolbar popup has the same one-click path plus the finer-grained
controls: **Download archive** (collect the current profile + save),
**Collect only**, **Download selected** (re-download a previously archived
profile without collecting), **Collect bookmarks**, **Download bookmarks
archive**, and Stop while a run is in flight.

## Use: bookmarks

1. From the repository root, run pnpm install and pnpm run dist.
2. Open chrome://extensions, enable Developer mode, and load
   dist/extension-suite as an unpacked extension.
3. Sign in to X and **reload** [your bookmarks](https://x.com/i/bookmarks).
   The suite service worker passively captures the current GraphQL query ID,
   request features, and X web-app authorization header.
4. Click the suite toolbar icon and choose **Collect bookmarks**. Each page
   is saved locally to IndexedDB; retries and throttling handle transient
   failures and HTTP 429 responses.
5. To include premium bookmark folders, first open a folder on X as well,
   allowing its GraphQL operation to be captured. The exporter will list
   available folders and scan each one when both operation IDs are present.
6. Select **Download bookmarks archive**. The account-scoped cumulative
   archive is written to `bookmarks-<date>/` as `bookmarks.json` plus each
   available bookmark's media files (photos and videos, quoted-post media
   included) and a `debug.json`. Exports are incremental: collecting only
   re-downloads what is new, media failures are retried, and the export
   overwrites the same-day folder in place. The JSON includes the text,
   author, links, quoted posts, and folder memberships X returned.

## Use: a profile's entire posts

The popup and context menu can archive the full post history of any profile you
can view on X — original posts, reposts, and replies — as `posts.json` plus the
actual media files (photos and videos). X serves a profile timeline through the
same private GraphQL mechanism as bookmarks, so the same capture-then-paginate
strategy applies; the page scrolls itself, no autoscrolling of the visible tab
is required. Profile requests are captured passively whenever a profile issues
them, and the popup, context menu, and deep links all target the profile open
in the tab you clicked from — so a profile is usable as long as it has been
opened once in this browser. The handle is resolved to X's numeric user id
through the captured `UserByScreenName` lookup request at collection time;
after the first successful run the binding is stored.

1. In a signed-in tab, open the profile, e.g. `https://x.com/jack`, and load:
   - the **Posts** tab (captures `UserOriginalsTimeline` — original posts and
     reposts; X's renamed successor to `UserTweets`), and
   - the **Replies** tab (captures `UserRepliesTimeline` — the replies; X only
     serves it there; renamed successor to `UserTweetsAndReplies`).
     Loading both gives a complete archive.
2. Then either:
   - open the toolbar popup and click **Download @handle archive**, or
   - right-click the page and choose **Collect and download profile posts…**.

Collection paginates the captured timeline into IndexedDB, per account and
per target profile. With both tabs captured it scans originals first and
replies second into the same archive; with only one tab captured it archives
that part and reports which side is missing (`complete`,
`complete_without_replies`, or `complete_without_posts`). Stop any
time; re-running is safe. The popup and context menu paths collect first, then
export the freshly updated archive automatically. Legacy `UserTweets` /
`UserTweetsAndReplies` captures are still honoured as a fallback. The replay
sends X's renamed-operation contract — the `fieldToggles` query parameter and
each operation's required variables (`withVoice`/`withCommunity`/
`withQuickPromoteEligibilityTweetFields` as applicable) — and includes X's
own GraphQL error message in any failure, so a rejection is diagnosable from
`debug.json` without a live session.

The export creates a folder `<handle>-<date>/` in your downloads (falling
back to `x-profile-<userId>-<date>/` when the handle isn't known yet — e.g.
an empty archive whose scan failed before saving anything):

```
jack-2026-11-15/
  posts.json
  debug.json             everything needed to diagnose a failed or empty archive
  media/
    9876543210_0.jpg        first photo of that post
    9876543210_1.mp4        highest-bitrate MP4 variant of that post's video
    1234567890_quoted_0.jpg photo inside a quoted post
    …
```

`debug.json` carries the last request the extension captured on this browser
(with query IDs and the exact `variables` payload for timeline operations),
the list of x.com GraphQL operations the extension saw but doesn't understand,
the last recorded error, a timestamped log of what the page was doing, and the
archive metadata. It deliberately includes **no** authorization headers,
cookies, CSRF tokens, or client transaction IDs — only operation names, X's
public client configuration (query IDs and feature flags), and local run
state. Attach it when reporting a broken archive.

- Media filenames are `<tweet_id>_<index>.<ext>`; quoted-post media uses
  `<tweet_id>_quoted_<index>.<ext>`. Photos use the original-size rendition
  X serves; videos and animated GIFs use the highest-bitrate `video/mp4` variant.
- `posts.json` is downloaded first; unavailable or failing media files are
  reported at the end, and re-running **Download archive** retries them
  (idempotent overwrite, never duplicated).
- Live progress is shown in the popup (posts, pages, media x/y, Stop button)
  and on the toolbar icon as a badge. The archive engine runs in the
  extension's service worker, so leaving or closing the popup cannot stop a
  run. If Chrome itself kills the service worker mid-run, the run stops
  cleanly: pages saved so far are kept, the popup reports the failure, and
  re-running resumes monotonically (pages are merged, never duplicated).

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
      "operation": "UserOriginalsTimeline" // which timeline operation was scanned
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
unavailable posts may contain only IDs. The engine runs in the service
worker, not the popup, so it does not need any tab or page to stay open —
only the browser itself to be running.

## Implementation and security

- Authenticated requests execute from the extension's service worker using the
  logged-in browser session. The service worker passively observes X GraphQL
  requests, only when the URL shape is one it recognizes; it records the
  current query IDs, feature flags, an authorization header, and the last
  visited profile's user id — never post content. The popup (via its active
  tab) and the context menu (via its page URL) target the profile open in
  the tab that launched the flow; when only the handle is known, the handle
  is converted to X's numeric user id by replaying the captured
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
  media so the manifest is never blocked by a media failure. Both JSON files
  are written as data URLs into the downloads folder by the service worker.
- Source inspiration: [xarchive](https://github.com/sytelus/xarchive),
  copyright its respective authors, MIT license. This port is an independent
  reduced implementation, not a drop-in replacement for xarchive's viewer,
  reconciliation, import, and undo features.

## Troubleshooting

**Everything is greyed out.** The popup can only see the cookies of the
browser it is installed in. If you use x.com in a different browser than the one
carrying the extension, the X Archive buttons stay disabled — sign in to x.com
in *that* browser first. Each disabled button also carries a tooltip
explaining exactly what it needs.

**"Visit a profile on x.com first" even though the profile is open.** The popup
targets the profile in the active x.com tab, so make sure that tab is the
profile — token URLs like `https://x.com/jack`, `…/jack/with_replies`,
`…/jack/media` all work; a whole post page (`…/jack/status/123`) does not. If
a run then reports the lookup request was never captured, the extension
has not seen any request from x.com in this browser since it was reloaded —
reload the profile page once and try again. After each run, `debug.json` in the
download folder records the last request the extension captured and when, and
lists every x.com GraphQL operation it saw but doesn't understand — attach it
when reporting a broken archive.

**"Collect profile posts" stays greyed out and the timeline was never captured.**
X often serves a profile's first page inline from the streamed page and only
fetches older pages over GraphQL when you scroll. Reload the profile tab once,
then **scroll the timeline a little** so the timeline request fires, and reopen
the popup. The `debug.json` from the last run lists the GraphQL operations X
made on this browser that the extension does not understand — if a
timeline-looking name shows up there (e.g. a renamed timeline operation),
report it.

**"X rejected the captured query (HTTP 422/404)."** The failure note carries X's
GraphQL error message verbatim. Reload the profile tab once and scroll the
timeline a little, then try again. If it persists, attach `debug.json` — it
now records the captured `fieldToggles`, the exact variables the extension
replays, and the error X returned, which is enough to pin the contract drift.

**"X could not resolve @handle to a user id."** Reload the profile page once;
if it persists, report it — X changed its lookup response shape. The
`debug.json` in the download folder records the exact failure and the
`UserByScreenName` payload, which is enough to pin it down without a live
session.

**"X changed its timeline response. Partial results were preserved."** X changed
its private GraphQL shape or served something unexpected; the posts captured so
far are kept. Reload and try again; if it persists, report the shape drift.

## Development

pnpm run check runs strict typechecking and unit tests. pnpm run dist
builds the unified extension. extension-x-bookmarks/test covers response
parsing, account safety, credential capture, merging, profile-timeline parsing
(including reposts and quoted media), media planning and download tracking.
