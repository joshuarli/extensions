# x-archive-cli

`x` archives your X data to local folders you own — cumulative archives driven
entirely from the terminal. The installed extension only supplies captured X
GraphQL credentials; it has no archive UI.

It does not need a browser download pipeline (which keeps failing on
long MV3 exports) and it never stores cookies on disk: the session is
read from your running Helium — or a dedicated bctl appliance with
`--backend=bctl` — over CDP on each invocation. Everything
it saves is bookmarks/likes/profile exports in a folder you can open,
keep, or move.

## Use

```sh
pnpm x download self                 # bookmarks + likes, posts JSON + media + render
pnpm x download token___garden       # @handle or x.com profile URL: posts, reposts, replies
pnpm x download token___garden       # same command updates it: only newer posts are fetched
pnpm x download inve1ns cleanjpg     # several profiles, one after another (serial)
pnpm x download self inve1ns         # self and profiles in one run
pnpm x download self --export-only   # re-export from saved data, no re-collection
pnpm x download self --no-render     # skip archive.html
pnpm x download self --collect-only  # collect only
pnpm x download token___garden --out=/path   # downloads root (default ~/.local/share/x/downloads)
```

Targets are processed serially in the order given; a failure stops the run, and
re-running resumes each target from its saved checkpoint.

`x` writes exports to a well-known root, `~/.local/share/x/downloads`
(`X_ARCHIVE_DOWNLOADS` or `XDG_DATA_HOME` override it; `--out=DIR` sets it
per run). A self export writes `<root>/bookmarks-<date>/` and
`<root>/likes-<date>/`. A profile export writes `<root>/<handle>/` and is
updated in place on every re-run: `x download <handle>` fetches only posts
newer than what is already archived and stops as soon as a timeline page is
fully covered by the archive. Each export folder holds `<kind>.json`
(`bookmarks.json`, `likes.json`, or `posts.json`), a `media/` folder with
the actual files, `debug.json`, and `archive.html` — a static, X-styled page
of the whole archive (lazy-loaded media, inline lightbox; the page carries
one small inline script and makes no external requests). The page references
`media/` relatively, so the
folder must travel intact (a 13 GB inlined file helps nobody); open
`archive.html` to browse the archive.

`collection: complete` in `debug.json` means X's timeline was fully
scanned. X rate-limits large timelines aggressively; if a run stops
early, re-running resumes from the saved cursor — saved pages are
retained either way.

## How it works

- **Session**: the CLI attaches to a browser over CDP — the Helium
  browser on `127.0.0.1:9222` by default (override with `--cdp-url` or
  `X_ARCHIVE_CDP_URL`), or a dedicated bctl appliance with
  `--backend=bctl` (see [bctl](#bctl)). It reads
  your x.com cookies (including HttpOnly ones) and, from the X Archive
  extension's storage, the query IDs/features X's web app uses for the
  GraphQL API. On the Helium path the CLI hot-loads the embedded suite
  extension from a cache directory over CDP; its manifest key pins the ID
  across machines. The extension is session-only, so this is repeated each
  run. If an operation was never captured, the CLI opens the relevant x.com
  page (bookmarks, likes, or the profile) and caches the credentials for 30
  days. No checkout, build, or manual extension install is needed. A
  reachable CDP browser is required; cached credentials are used only when
  the browser cannot be reached.
- **Store**: a profile archive is a SQLite database,
  `~/.local/share/x/downloads/<handle>/archive.db`, holding every observed
  post (merged by tweet id), the per-timeline scan state, and the learned
  profile — the resumability state travels with the folder. Bookmarks and
  likes keep a cumulative filesystem store under
  `~/.local/state/x-archive/` (`X_ARCHIVE_STATE` overrides), the mirror
  of the extension's IndexedDB layout.
  Unreadable files, invalid JSON or UTF-8, and non-array record files stop
  collection before the existing archive file is replaced. Missing files
  initialize a new store normally.
- **Incremental updates**: a profile scan always starts from the newest
  posts. Once an earlier run completed, each timeline stops fetching after
  the first page whose posts are all already archived, so re-downloading a
  quiet profile costs a page per timeline. If a previous scan was
  interrupted, it resumes from the checkpointed cursor as before; an
  interrupted scan never looks caught up until it reaches archived pages.
- **Thread context**: profile downloads also fetch the strangers' ancestor
  posts that archived replies reply to — one request per missing ancestor,
  resumable per page, text and metrics only, no profile photos and no
  media — and store them in the same archive.db, so `posts.json` carries a
  separate `context_posts` array (readers ignore the extra top-level key)
  and the archive page renders threads fully offline. `--no-context` skips
  the backfill; the first run takes a while, and re-running resumes it.
- **Seeding**: on each run the CLI seeds bookmarks and likes from any legacy
  extension IndexedDB archive still in the browser, by count, so earlier
  extension archives carry over without re-collection. The extension no
  longer writes those databases; fresh installs start from the CLI's own
  filesystem store. A profile archive is seeded the same way when you run
  `x download <handle>`; `x download self` no longer pre-seeds profile
  archives.
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

`--backend=bctl` runs the collection against a dedicated bctl appliance
instead of everyday Helium — for unattended or background runs (idle
machine, overnight) without keeping the daily browser open with a debug
port:

```sh
bctl profile login xarchive       # once: sign in to x.com in the appliance
x download self --backend=bctl
```

One manual sign-in is all; `x` launches or reuses the session (profile
and session both default to `xarchive`, `--session=NAME` or
`X_ARCHIVE_SESSION` to override), reads the X session cookies from the
guest over CDP and collects exactly as on the Helium path. The appliance
holds the signed-in session between runs and never needs x.com access
during a collection; GraphQL and media stay host-HTTPS. Stop the session
when you are done with `bctl down xarchive`.

The appliance has no extension and no access to your Helium profile, so:

- seeding from Helium's IndexedDB is skipped (the local store is used),
- credentials come from the credential cache seeded by any normal Helium
  run (seeded by `x download self` on the Helium backend; reused for 30
  days). Without a cache the run fails with the remedy; the appliance
  cannot capture fresh ones,
- a signed-out or unreachable appliance fails fast with the sign-in instruction.

Prerequisites: `bctl` on PATH (or `X_ARCHIVE_BCTL=/path/to/bctl`), a
working Nanos runtime (`bctl doctor` passes), and the one-time sign-in.
X may treat the appliance as a new device and ask for verification; do
the sign-in by hand and confirm it sticks before relying on overnight
runs. `X_ARCHIVE_BACKEND=bctl` and `X_ARCHIVE_CDP_URL=URL` (attach to an
already-minted endpoint instead of launching) are supported.

## Notes

- The CLI inherits the old extension's archive format and update semantics
  (`x-archive-core/src/render.ts`, export folders, `debug.json`); collection and export
  now happen only here. The extension's remaining job is to capture fresh X
  GraphQL query IDs, features, and authorization from normal browsing.
  Profile stores written before the per-folder SQLite store landed live
  under `~/.local/state/x-archive/stores/<account>/profile/<target>/` and
  are no longer read.
- `X_ARCHIVE_DEBUG=1` prints the URL (no secrets) and HTTP status of
  each GraphQL call for API-drift debugging.
- The state dir holds the credential cache and cumulative bookmarks and
  likes, which may be private. It does not hold your cookies: those stay
  in the browser.
