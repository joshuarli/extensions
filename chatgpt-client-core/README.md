# chatgpt-client-core

The typed ChatGPT client used by `chatgpt-archive-cli`. It owns the browser
connection, the session, and the request policy. `chatgpt-archive-core` owns the
archive domain and receives the client's `transport`; it does not change.

## Usage

```ts
import { connectChatgpt } from "chatgpt-client-core/src/index.ts";

const client = await connectChatgpt({
  expectedAccountId: "user-123",
  onStatus: (message) => process.stderr.write(message + "\n"),
});
try {
  const archive = createChatgptArchive({ transport: client.transport, ... });
  // ...
} finally {
  await client.close();
}
```

`connectChatgpt` resolves the backend exactly as the CLI does. It reads
`/api/auth/session` once, checks `accountId` against `expectedAccountId` when
one is supplied, and caches the raw session response. Later calls to
`getJson("/api/auth/session")` return that cached response without a second
request. Close the client to release the browser connection.

### Options

| Option | Meaning |
| --- | --- |
| `cdpUrl`, `backend`, `session` | Backend selection, passed to `resolveBackend`. |
| `expectedAccountId` | Stop before any archive request when the signed-in account differs. |
| `signal` | Aborts the session read, backoff waits, and in-page requests. |
| `onStatus` | Receives re-authentication and backoff notices. |
| `dependencies` | Replaces `fetchJson`, `fetchBytes`, or `sleep` for tests. |
| `maxRetries` | Retry budget for network, 429, and 5xx responses (default 4). |
| `retryBaseMs` | First backoff wait, doubled on each retry (default 1000). |

### Request policy

`transport.getJson` and `transport.getBytes` send `Authorization: Bearer
<accessToken>`. On a 401 or 403 the client reads the session again once and
retries with the new token. If the account changed, or the refreshed session is
rejected again, the run stops with an `auth` failure. On a 429 or 5xx the client
waits with exponential backoff up to `maxRetries`, then stops with a `rate_limit`
or `transport` failure. Transport exceptions retry within the same budget.

Failure kinds are `auth`, `rate_limit`, `transport`, `shape`, and `stopped`. A
changed session response raises `shape` before any conversation is fetched. All
failures are `ChatgptRequestFailure`, tagged with `_tag` for `Schema` and
`Effect` narrowing.

## Operations

`CHATGPT_OPERATIONS` names the four requests the archive makes. Each has a
recipe in `recipes/` that records the path template, caller inputs, response
dependencies, session material, observation steps, and verification cases. The
recipes are documentation; `test/recipes.test.ts` derives the real paths from
`createChatgptArchive` and fails when a recipe drifts from the code.

## Tests

```
pnpm exec vitest run chatgpt-client-core --maxWorkers=1
```

The tests inject `fetchJson`, `fetchBytes`, and `sleep`, so they never open a
browser or contact chatgpt.com. They cover the account guard, cached session,
shape and auth failures, re-authentication, retry backoff, abort, and media
requests.
