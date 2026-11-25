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

Each calendar day writes to `DIR/chatgpt-YYYY-MM-DD/`:

- `records.jsonl` — one encoded `ArchivedRecord` per line, append-only.
- `media/` — downloaded media files, one per referenced file id.
- `manifest.json` — rewritten at the end of each run, covering every record
  in that day's file, including `sha256OfRecords` of the records file and a
  `media` object with `downloaded`, `failed`, `skipped` and `errors`.

On a rerun, the CLI decodes existing lines, skips ids already present, and
appends only missing records. A `--limit` run can therefore be repeated to
continue where it stopped. After SIGINT, saved records are kept and the next
run resumes from them. No file is ever truncated. Note that `manifest.json`
is regenerated from the current run's chat lists, so its `archived` count is
only meaningful when `--include-archived` was passed.

### Media

By default the CLI also downloads media referenced by the archived records.
It extracts `file-service://<id>` pointers (including object `asset_pointer`
values) and `library_file_id` references from `message.metadata.content_references`,
then requests `GET /backend-api/files/{id}/download` through the signed-in
browser page. Bytes are written to `media/<sanitized-name>-<hash>.bin` through a
`.part` file that is renamed into place only after a complete response. Existing
complete files are skipped and never overwritten; a rerun therefore fills in
only what is missing. Up to four downloads run at once, and the `media` phase
plus the final summary report downloaded, failed and skipped counts.

Downloads are **best-effort**: an individual failure never fails the archive.
Failures are recorded in `manifest.json` as `{ "id": "…", "error": "…" }` and
include library files that no longer resolve, expired or rotated download
links, and non-2xx responses or JSON error bodies from the endpoint. The bytes
are not interpreted, so a non-image response can still be stored as a `.bin`
file if the endpoint returns it without an error status; a human should verify
the files when a record had unusual attachments. Pass `--no-media` to skip the
whole step. No cookies, access tokens or request headers are written to disk;
filenames are derived from file ids and optional pointer file names only.

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
- `src/main.ts` — importable command entry point; `src/cli.ts` is the process wrapper.

## Tests

```
pnpm exec vitest run chatgpt-archive-cli --maxWorkers=1
```

The tests cover flag parsing, resume with an in-memory filesystem,
timeframe/archived selection with a fake archive, and media extraction,
skip-existing, atomic writes, failure reporting, concurrency and `--no-media`
with fake transport and fake filesystem. They do not contact the network or
launch a browser.
