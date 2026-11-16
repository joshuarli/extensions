# x-archive-cli

`x` archives your X data to local folders you own — the same cumulative
archives the X Archive browser extension produces, driven from the
terminal instead of a toolbar click.

It does not need a browser download pipeline (which keeps failing on
long MV3 exports) and it never stores cookies on disk: the session is
read from your running Helium over CDP on each invocation. Everything
it saves is bookmarks/likes/profile exports in a folder you can open,
keep, or move.

## Use

```sh
pnpm x download self                 # bookmarks + likes, posts JSON + media + render
pnpm x download token___garden       # @handle or x.com profile URL: posts, reposts, replies
pnpm x download self --export-only   # re-export from saved data, no re-collection
pnpm x download self --no-render     # skip archive.html
pnpm x download self --collect-only  # collect only
pnpm x download self --out=/path     # output root (default ~/Downloads)
```

Each export writes `<folder>-<date>/` with `<kind>.json` (`bookmarks.json`,
`likes.json`, or `posts.json`), a `media/` folder with the actual files,
`debug.json`, and `archive.html` — a static, script-free, X-styled page
of the whole archive. Rendering is external-media for large archives
(>256 MB of media) and fully inline otherwise, so the HTML is always
usable offline; open it to browse the archive.

`collection: complete` in `debug.json` means X's timeline was fully
scanned. X rate-limits large timelines aggressively; if a run stops
early, re-running resumes from the saved cursor — saved pages are
retained either way.

## How it works

- **Session**: the CLI attaches to the Helium browser on
  `127.0.0.1:9222` (override with `--cdp-url` or `X_ARCHIVE_CDP_URL`)
  via CDP — the same endpoint your `helium` launcher enables. It reads
  your x.com cookies (including HttpOnly ones) and, from the X Archive
  extension's storage, the query IDs/features X's web app uses for the
  GraphQL API. If Helium is not running, or the extension is not
  loaded, cached credentials (when present) are used or a precise error
  tells you what to open once in Helium.
- **Store**: a cumulative filesystem store under
  `~/.local/state/x-archive/` (`X_ARCHIVE_STATE` overrides) holds every
  observed post, merged by tweet id on every page saved — the mirror
  of the extension's IndexedDB layout.
- **Seeding**: on each run the CLI seeds the store from the extension's
  IndexedDB (bookmarks, likes, every profile archive) by count, so the
  first CLI export contains everything the extension already archived —
  no re-collection needed.
- **Collection**: same pagination, rate-limit handling, cursor
  checkpoint/resume, and reposts/replies unwrapping as the extension.
  Profile export includes the account's own replies via the captured
  `UserRepliesTimeline` operation.
- **Media**: fetched over plain HTTPS (photos, best-bitrate MP4s, quoted
  post media included) with the archive's own filenames, skipping files
  already on disk, and verified (HTTP 200, non-text content type, min
  size) before landing — the same atomics you get from the extension's
  downloads.

## bctl

A bctl appliance backend (signed-in guest session, background runs) is
designed against this seam but not built yet — see `EXT-1` in `TODO.md`.

## Notes

- The CLI duplicates the X Archive extension's behavior by design: the
  extension stays the one-click path for normal use; the CLI is for
  scripted and unattended use. They share the archive format and the
  update semantics (`render_archive.py`, export folders, `debug.json`).
- `X_ARCHIVE_DEBUG=1` prints the URL (no secrets) and HTTP status of
  each GraphQL call for API-drift debugging.
- The state dir contains only public X web-app configuration and the
  public web bearer token; no cookies or credentials are ever written
  to disk (cookies live in the running browser; the credential cache
  holds query IDs/features only). If you copied this directory
  elsewhere, nothing sensitive travels with it.
