# X Archive support

This package is no longer a user-facing archive feature. It supplies the one
capability `x-archive-cli` still needs from the installed extension: passive
capture of X's private GraphQL configuration from normal x.com browsing.

## What the extension still does

The suite service worker observes `https://x.com/i/api/graphql/*` request
headers from x.com pages and stores the current query IDs, feature flags,
`fieldToggles`, authorization header, client UUID, and transaction ID in
`chrome.storage.local` under `x_bookmarks_credentials_<account id>`. The
account id comes from the `twid` cookie. Capture is serialized and concurrent
with page requests; it never records post content or writes secrets into an
export.

`x-archive-cli` reads that storage key from the extension service worker over
CDP to authenticate its own GraphQL calls (see `x-archive-cli/src/deps.ts`).
It reads cookies itself over CDP and keeps a 30-day credential cache when no
extension or signed-in browser is available.

`archive.html` rendering lives in `x-archive-core/src/render.ts` and is shared
with the CLI; no Python renderer is needed.

## What was removed

The popup and options UI, context menus, toolbar badge, run-state tracking,
and the `x-bookmarks/run` suite message are gone. So are the collection engine,
IndexedDB archive adapters, downloads, and the extension's own DNR header
rules — the CLI collects, stores, and exports entirely on its own.

Archives previously collected into the extension's IndexedDB are still read
by the CLI's legacy seeding path (`x-archive-cli/src/seed.ts`); the extension
no longer writes those databases and no migration is required.
