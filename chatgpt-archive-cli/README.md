# chatgpt-archive-cli

Terminal CLI that archives ChatGPT conversations to the local filesystem. It
uses the domain logic in the sibling `chatgpt-archive-core` package and the
shared terminal shell in `lib/cli.ts`; all ChatGPT requests are made by
`fetch` inside an already signed-in `https://chatgpt.com/*` page reached over
CDP.

## Usage

```
node chatgpt-archive-cli/src/cli.ts download [options] (or `pnpm tools chatgpt download [options]`)
```

| Option | Meaning |
| --- | --- |
| `--since ISO` | Only archive chats at or after this inclusive ISO-8601 timestamp. |
| `--until ISO` | Only archive chats at or before this inclusive ISO-8601 timestamp. |
| `--time-field created\|updated` | Which chat timestamp the range compares (default `updated`). |
| `--out DIR` | Downloads root (default `~/.local/share/chatgpt-archive/downloads`, or `CHATGPT_ARCHIVE_DOWNLOADS` / `XDG_DATA_HOME`). |
| `--include-archived` | Include the Archived section alongside active chats. |
| `--no-media` | Skip media downloads; only conversation JSON is archived. |
| `--max-media-size SIZE` | Largest media file to save (default 16MB; `0` disables). SIZE is bytes or B/KB/MB/GB. Oversized files stay referenced in the records but are not written. |
| `--limit N` | Write at most *N* new records in this run, for timeboxed spikes. |
| `--backend helium\|bctl` | `helium` (default) attaches to a local Helium instance; `bctl` uses a dedicated session. |
| `--session NAME` | bctl session name (default `chatgpt-archive`, or `CHATGPT_ARCHIVE_SESSION`). |
| `--cdp-url URL` | Attach to an existing CDP endpoint instead of the default `http://127.0.0.1:9222` or a bctl session. |
| `--help`, `-h` | Show the full usage text. |
| `--version`, `-v` | Print the version. |

`CHATGPT_ARCHIVE_BACKEND`, `CHATGPT_ARCHIVE_SESSION`, `CHATGPT_ARCHIVE_CDP_URL`
and `CHATGPT_ARCHIVE_BCTL` override the corresponding defaults.

### Browser and sign-in

The default backend attaches to Helium's debugging port on
`http://127.0.0.1:9222`. Start Helium with remote debugging enabled and sign in
to chatgpt.com once in that browser. The CLI reuses an open
`https://chatgpt.com/*` tab, or opens one if none exists. If the page is not
signed in, the run fails with a clear message. Use `--cdp-url` to attach to a
different endpoint, or `--backend bctl` for a dedicated session.

ChatGPT traffic goes through the browser page (`fetch` with
`credentials: "include"`). No cookies or access tokens are written to disk,
and the manifest records only the account id.

### Timeframe semantics

`--since` and `--until` are inclusive ISO-8601 timestamps compared against the
field chosen by `--time-field` (`updated` by default). They are applied to
conversation metadata before the full conversation is fetched, so a narrow
range avoids most record requests. A chat created before `--since` is still
archived when its update time falls inside the range. Both bounds are
optional.

### Resume and layout

Each account archives to a stable `DIR/chatgpt-<account-id>/`:

- `records.jsonl` — one encoded `ArchivedRecord` per line, append-only.
  Readers keep the newest line per id, so a chat updated since it was saved
  appends a new version rather than rewriting history.
- `media/` — downloaded media files, one per referenced file id, shared by
  every run.
- `state.json` — per-scope scan checkpoints (`complete` and pages `scanned`),
  written atomically at the end of each run.
- `manifest.json` — rewritten at the end of each run from what was saved,
  including `sha256OfRecords` of the records file and a `media` object with
  `downloaded`, `failed`, `skipped`, `errors` and `oversized`.

On a rerun, the CLI skips saved ids, appends missing ones, and appends a new
line for any chat whose update time or title changed. `state.json` records
which conversation lists were scanned completely: on later runs the listing
stops at the first page whose chats are all already saved and unchanged, so a
quiet account costs one page per included scope instead of a full scan. A
`--limit` run can be repeated on any later day to continue where it stopped;
the folder never changes with the date. Records from older
`chatgpt-YYYY-MM-DD/` folders under the same root are imported into the
account folder on its first run. No file is ever truncated. `manifest.json`'s
`archived` count is only meaningful when `--include-archived` was passed.

Press Ctrl-C once to stop after the current record or media file: saved
records, media and state are kept, `manifest.json` is rebuilt from what was
saved, no further work starts, and the run exits 130. A second Ctrl-C forces
an immediate exit. Rerunning resumes from the saved state.

### Media

By default the CLI also downloads media referenced by the archived records.
It extracts `file-service://<id>` pointers (including object `asset_pointer`
values) and `library_file_id` references from `message.metadata.content_references`,
then requests `GET /backend-api/files/{id}/download` through the signed-in
browser page. Bytes are written to `media/<sanitized-name>-<hash>.bin` through a
`.part` file that is renamed into place only after a complete response. Existing
complete files are skipped and never overwritten, and up to four downloads run
at once.

Files larger than `--max-media-size` are skipped before landing: the id is
listed under `media.oversized` in `manifest.json` and the reference stays in
`records.jsonl`, so raising the limit on a later run fetches it. Empty bodies
and JSON error bodies are treated as failures rather than media.

Downloads are **best-effort**: an individual failure never fails the archive.
Failures are recorded in `manifest.json` as `{ "id": "…", "error": "…" }` and
include library files that no longer resolve, expired or rotated download
links, and non-2xx responses from the endpoint. The bytes are not interpreted,
so a non-image response can still be stored as a `.bin` file if the endpoint
returns it without an error status; a human should verify the files when a
record had unusual attachments. Pass `--no-media` to skip the whole step. No
cookies, access tokens or request headers are written to disk; filenames are
derived from file ids and optional pointer file names only.

## Design

- `src/args.ts` — `parseCliArgs`-based flags, validation and usage text.
- `src/backend.ts` — `createBackendResolver` configured for this CLI.
- `src/browser.ts` — CDP attach/page discovery and the `ChatgptTransport`
  implementation backed by in-page `fetch`, including `getBytes` for media.
- `src/download.ts` — selection, resume, append-only writes, progress phases
  (`session`, `list active`, `list archived`, `records`, `media`, `manifest`)
  and the final summary.
- `src/media.ts` — media job collection from saved records, bounded-concurrency
  downloads, atomic `.part` rename and failure collection.
- `src/storage.ts` — small filesystem seam plus Web Crypto SHA-256.
- `src/state.ts` — stable account folder, checkpoint I/O and legacy record import.
- `src/main.ts` — importable command entry point; `src/cli.ts` is the process wrapper.
- Interrupt control and media size parsing are shared with the X CLI through
  `lib/cli.ts` and `lib/media.ts`.

## Tests

```
pnpm exec vitest run chatgpt-archive-cli --maxWorkers=1
```

The tests cover flag parsing, append-only resume with an in-memory filesystem,
timeframe/archived selection with a fake archive, and media extraction,
skip-existing, atomic writes, failure reporting, concurrency and `--no-media`
with fake transport and fake filesystem. `test/parity.test.ts` covers
checkpointed listing, refresh of changed chats, cross-day resume and legacy
import, cooperative interruption, and the media size cap. They do not contact
the network or launch a browser.
