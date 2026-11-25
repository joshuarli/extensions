# instagram-archive-cli

Terminal CLI that archives Instagram posts, reels, and saved collections. It
uses `instagram-client-core` for the browser session and request policy and
`instagram-archive-core` for parsing, completion, and site rendering.

## Usage

```
pnpm tools ig <command> [options] [@username ...]
pnpm ig <command> [options] [@username ...]
```

| Command | Meaning |
| --- | --- |
| `scan` | Record profile or saved membership. `--saved [@username]` targets a profile's Saved tab, scrolling through every page. |
| `get` | Download missing media for recorded posts. |
| `update` | Scan known collections, then download missing media. |
| `build` | Render the static site. |
| `info` | Summarize the archive. |
| `following` | Print the logged-in account's following list. |

Options: `--saved`, `--out DIR`, `--media-dir DIR`, `--pause-ms N`,
`--max-media-size SIZE`, `--limit N`, `--resume`, `--refresh`, `--dry-run`,
`--backend`, `--session`, `--cdp-url`, `--help`, `--version`. Run
`pnpm tools ig --help` for the full text.

The default backend attaches to Helium on `127.0.0.1:9222`. Sign in to Instagram
once in that browser. No cookies, tokens, or headers are written to disk.

To archive a profile's Saved tab, pass the profile with `--saved`:
`pnpm tools ig update --saved @teaandvessel`. Without a target, `--saved` uses
the signed-in account's own saved posts.

## Pacing

`scan` waits between timeline pages and `get` waits between posts, 1500 ms by
default (`--pause-ms N`; 0 disables). Requests are serial: one post and one
media file at a time.

## Storage and resume

Each collection lives directly in `<out>/@<name>/`: `@username` for a profile
and `@username-saved` for that profile's Saved tab. It holds `records.jsonl`
(posts in DOM order; resolved media URLs are recorded when a post is fetched),
`state.json` (cursor and completion checkpoint), and `images/`. The `@` prefix
keeps collection folders distinct from the root's generated files. A finished
media file is never overwritten. Completion requires every media path to exist
and be nonempty.

`build` writes a collection page and data JSON beside the records so the
relative `images/` paths resolve, plus an index and a `README.md` at the
archive root. The default root is `~/.local/share/instagram-archive`.

Archives created before the layout was flattened still use
`<out>/ig-<account-id>/collections/<name>/`. Move each `<name>` folder to
`<out>/@<name>/` once, then re-run `build`.

## Parking

A rate limit, login redirect, checkpoint, account warning, or unrecognized
response parks the whole job: the CLI writes `<out>/job.json` with the reason,
operation, collection, last completed shortcode, and time. Later runs refuse to
start until `--resume` is passed. Ctrl-C stops after the current post or media
file, keeps what was saved, and exits 130.

## Media

Media URLs come from the post's embedded Relay web-info state, not from page
thumbnails, so avatars and recommended posts are never archived. Images and
standard video URLs are fetched with the browser's session cookies.
For video posts the CLI first tries the authenticated DASH manifest and muxes
the selected video and audio tracks with ffmpeg. When that endpoint is
unavailable, it uses the standard URL. A mux failure records the file as failed
without parking the archive.

## Media size limit

By default the CLI saves only media up to 512 MB. `--max-media-size` accepts
bytes or a B/K/M/G suffix (`512MB`, `500KB`, `0` for unlimited). When the server
reports `Content-Length`, an oversized file is skipped before any body bytes
are read; otherwise the stream is discarded as soon as it passes the cap.
Skipped files are reported in the summary, are not written to disk, and stay
unfinished so raising the limit on a later run can fetch them.

## Parity

The scan path was compared against Python `ig` on 2026-11-25 using the same
signed-in browser over `--backend cdp --cdp-url http://127.0.0.1:9222`. Both
implementations recorded 123 posts from the same profile. Identity, membership,
order, post types, media URL paths, and dimensions matched. Audio presence and
duration were not compared because Instagram no longer serves the v1
media-info endpoint used by the Python DASH path.

## Tests

```
pnpm exec vitest run instagram-archive-cli --maxWorkers=1
```
