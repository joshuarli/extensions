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
| `scan` | Record profile or saved membership. |
| `get` | Download missing media for recorded posts. |
| `update` | Scan known collections, then download missing media. |
| `build` | Render the static site. |
| `info` | Summarize the archive. |
| `following` | Print the logged-in account's following list. |

Options: `--saved`, `--out DIR`, `--media-dir DIR`, `--jobs N`, `--limit N`,
`--resume`, `--refresh`, `--dry-run`, `--backend`, `--session`, `--cdp-url`,
`--help`, `--version`. Run `pnpm tools ig --help` for the full text.

The default backend attaches to Helium on `127.0.0.1:9222`. Sign in to Instagram
once in that browser. No cookies, tokens, or headers are written to disk.

## Storage and resume

Each account archives to `<out>/ig-<account-id>/`. A collection holds
`records.jsonl` (append-only posts in DOM order), `state.json` (cursor and
completion checkpoint), and `images/`. A finished media file is never
overwritten. Completion requires every media path to exist and be nonempty.

`build` writes a collection page and data JSON beside the records so the
relative `images/` paths resolve, plus an index at the archive root.

## Parking

A rate limit, login redirect, checkpoint, account warning, or unrecognized
response parks the whole job: the CLI writes `<out>/job.json` with the reason,
operation, collection, last completed shortcode, and time. Later runs refuse to
start until `--resume` is passed. Ctrl-C stops after the current post or media
file, keeps what was saved, and exits 130.

## Media

Images and standard video URLs are fetched with the browser's session cookies.
For video posts the CLI first tries the authenticated DASH manifest and muxes
the selected video and audio tracks with ffmpeg. When that endpoint is
unavailable, it uses the standard URL. A mux failure records the file as failed
without parking the archive.

## Tests

```
pnpm exec vitest run instagram-archive-cli --maxWorkers=1
```
