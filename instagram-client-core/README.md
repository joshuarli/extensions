# instagram-client-core

The typed Instagram client used by `instagram-archive-cli`. It owns the CDP
connection, the signed-in session, request policy, and browser-traffic capture.
`instagram-archive-core` owns the archive domain.

## Usage

```ts
import { connectInstagram } from "instagram-client-core/src/index.ts";

const client = await connectInstagram({
  expectedAccountId: priorAccountId,
  onStatus: (message) => process.stderr.write(message + "\n"),
});
try {
  const profile = await client.openProfile("username", signal);
  const page = await client.profilePage(profile, null, signal);
  // ...
} finally {
  await client.close();
}
```

`connectInstagram` reads instagram.com cookies once, requires `sessionid`,
`csrftoken`, and `ds_user_id`, and refuses to continue when the account differs
from `expectedAccountId`. No cookie value is written to disk or logged.

### Options

| Option | Meaning |
| --- | --- |
| `cdpUrl`, `backend`, `session` | Backend selection. |
| `expectedAccountId` | Stop before archive work when the signed-in account changed. |
| `signal`, `onStatus` | Cancellation and status notices. |
| `dependencies` | Replaces `cookies`, `navigate`, `pageText`, `onRequest`, `fetch`, `runQuery`, `postPage`, `savedShortcodes`, `fetchBytes`, `capture`, or `sleep`. |

`savedShortcodes(signal, username)` reads `/<username>/saved/all-posts/` when a
profile is given (otherwise the signed-in account's Saved tab) and accumulates
shortcodes while scrolling until no new ones appear.
| `maxRetries`, `retryBaseMs` | Retry budget for transport failures (default 3 and 500 ms). |

`mediaBytes(url, signal, maxBytes)` streams the body and throws `MediaTooLarge`
when `Content-Length` or the streamed bytes pass `maxBytes` (`0` means
unlimited). The cap is checked before reading a declared body.

### Operations and failures

`openProfile` observes the app's `PolarisProfilePostsQuery` POST body from
browser traffic and captures its `doc_id` and variables, then `profilePage`
reuses them with the page's DTSG and LSD tokens. A rejected query surfaces as a
typed failure and the caller re-observes. `postPage` reads a saved shortcode's
embedded Relay web-info state (carousels and the best image/video candidate per
slide) and throws `PostMediaUnavailable` when that state is absent, so avatar
and recommendation thumbnails on the page are never archived as post media.
`hqTracks` resolves DASH video and audio tracks.

`InstagramRequestFailure` kinds are `auth`, `rate_limit`, `checkpoint`,
`warning`, `unrecognized`, `transport`, `shape`, and `stopped`. `parksJob`
identifies the kinds that must park the whole CLI job. A 429 carries the
`Retry-After` hint. An unavailable optional HQ endpoint returns no tracks and
lets the downloader use the standard media URL.

Operation recipes live in `recipes/`. The tests derive real request paths,
parse post media from fixture Relay scripts, and exercise the client with
injected dependencies, so they never contact Instagram.

## Tests

```
pnpm exec vitest run instagram-client-core --maxWorkers=1
```
