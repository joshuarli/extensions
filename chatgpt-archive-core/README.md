# chatgpt-archive-core

Pure domain logic for archiving ChatGPT conversations. It has no dependency on the
CLI, browser, or Chrome APIs: every network call goes through an injected
`ChatgptTransport`, and every delay goes through the injected `sleep`.

## Usage

```ts
import { createChatgptArchive } from "chatgpt-archive-core/src/index.ts";

const archive = createChatgptArchive({
  transport,                 // getJson(path, headers?), optional getBytes(path, headers?)
  sleep: (ms) => delay(ms),
  now: () => Date.now(),
  requestGapMs: 1200,        // optional; defaults to 1200
});

const session = await archive.session(); // also stores session.accessToken internally
// or supply a token captured elsewhere:
archive.setToken(session.accessToken);
```

`session()` GETs `/api/auth/session` and returns `{ accountId, accessToken }`. It
throws a descriptive error when the response is signed out or missing either
field. It stores the access token on the returned object.

`list(scope, onPage?)` and `record(id)` read the token stored by `session()` or
`setToken(token)` and send it as `Authorization: Bearer <token>` through the
transport headers. Call `setToken` before either method if you are not calling
`session()` first; otherwise they throw.

Every `getJson` call is preceded by one `await deps.sleep(requestGapMs)` call —
no timers are used directly. `list` requests
`/backend-api/conversations?offset={n}&limit=100&order=updated`, adding
`&is_archived=true` for the `archived` scope, and advances the offset by the
number of rows actually returned until the reported `total` is reached. Rows
are normalized from `create_time`/`update_time` (epoch seconds) into epoch
milliseconds; a row missing or mistyping a required field throws rather than
being dropped. `record(id)` GETs `/backend-api/conversation/{id}` and returns the
raw conversation object unchanged, including all branches and metadata.

## Media

`extractMediaJobs(record)` walks a raw conversation record and returns one
`MediaJob` per unique referenced file: string `file-service://<id>` pointers
(in `asset_pointer` and anywhere else they occur), object `asset_pointer`
values with a `file_id`/`id`, and `library_file_id` values in metadata content
references. Jobs are sorted by id and carry `id`, a sanitized deterministic
`filename` and the `path` `/backend-api/files/{id}/download`.
`sanitizeMediaFilename(id, name?)` is the filename helper; ids and optional
pointer names are reduced to safe characters with a short hash suffix, so no
path separators or credentials can reach the filesystem.

`getMediaBytes(path)` uses the stored token, applies the same request gap as
other calls and delegates the response to the optional
`ChatgptTransport.getBytes(path, headers?)`. Existing transports that only
implement `getJson` keep working; calling `getMediaBytes` with such a transport
throws. Bytes are returned as `Uint8Array` — the core never writes files and
never interprets the response body. Media downloads are best-effort in the CLI:
missing library files, expired links, non-2xx responses and JSON error bodies
are reported as per-file failures rather than failing the archive.

## Archive format

`encodeRecordLine` writes one JSON object per line. The object is the
`ArchivedRecord` fields plus an envelope used for validation:

```json
{"format":"chatgpt-archive-record","version":1,"id":"…","title":"…","createdMs":0,"updatedMs":0,"url":"https://chatgpt.com/c/…","recordSha256":"…","record":{}}
```

`decodeRecordLine` parses and validates the object with Effect Schema and returns
`null` for malformed JSON, unknown `format`, unknown `version`, or a missing /
mistyped field. `recordSha256` is a SHA-256 over the canonicalized (recursively
sorted-key) JSON of the raw record, computed with Web Crypto, so identical
records hash identically regardless of key order.

`buildManifest` returns deterministic, two-space pretty JSON ending in a newline:

```json
{
  "format": "chatgpt-archive",
  "version": 1,
  "accountId": "…",
  "createdAt": "…",
  "since": null,
  "until": null,
  "timeField": "created",
  "total": 0,
  "archived": 0,
  "sha256OfRecords": "…",
  "media": { "downloaded": 0, "failed": 0, "skipped": 0, "errors": [] }
}
```

`createdAt` is taken from the input; an empty string falls back to
`new Date(deps.now()).toISOString()`. The `media` field is included only when
the caller supplies it, so older callers keep the same manifest shape.
