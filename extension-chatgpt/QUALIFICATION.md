# ChatGPT Organizer qualification

The final qualification started from `2fc662e568923f47c8ffa755a9cdf93af834658a`. The earlier safety repair followed the review of `31528575` (version 0.1.0).

## Safety invariants

1. **Backup before deletion.** When backup protection is on, a delete is sent only if the journal's durable `run.backup.saved.ids` contains that chat. A file write that was read back and hash-checked, or an explicit confirmation on the fallback path, sets that field. The queue checks it before every delete and re-reads the conversation to match its saved record digest. An unreadable or changed record is held for a fresh review.
2. **Exact authorization.** Each PATCH uses the command in the reviewed run and a fresh session for the run's account. Backend calls use that account's bearer authorization and omit cookies. Arm and change messages name the specific lease port. After pacing and asynchronous session validation, the service worker checks the same authorization immediately before calling fetch. A disconnected or replaced lease invalidates pending dispatches once Chrome delivers the port event. The queue withdraws jobs whose mark changed and clears only the matching reviewed mark after verification.
3. **Intent before send.** `run.inflight` is durably saved before each PATCH. If saving fails, the run pauses and nothing more is sent.
4. **Reconcile, then retry.** After a network error, 5xx, lost background response, redirect, or unfamiliar successful PATCH response, the queue probes before sending again. An undecidable probe preserves the in-flight intent and pauses the run. An acknowledged write starts as `pending` and a detail probe determines whether the requested state is present. An unavailable probe leaves the result `unverified` and **Retry verification** uses read-only requests. A probe that contradicts the requested state produces a `mismatch` and the run finishes with status `attention`.
5. **One runner.** A dashboard holds a Web Lock for its lifetime. A second dashboard waits and loads the journal only once the first closes.
6. **Pause and stop hold.** A loop step changes the run only while its abort signal is live and the run is still active. A late completion records its outcome but never overwrites a pause or a stop, even one made while a start, resume or backup acknowledgement is being saved.
7. **Credentials stay in the service worker.** The session response carries the account id only. The extension requests only `storage` and `https://chatgpt.com/*`.

## Fixed defects and regression tests

Unit tests are in `test/`. Browser tests are in `test/browser/extension-runtime.spec.ts` and drive the real dashboard against the routed fake backend in `test/browser/fake-chatgpt.ts`.

| Defect | Fix | Regression tests |
| --- | --- | --- |
| Backup save button unreachable; `saving` showed Pause/Stop | `runControls()` maps each status to exactly one control set | `model.test.ts` "maps every run status…"; browser "deletes only after a verified backup…" |
| Resuming in phase `save` deleted without a saved backup | Resume re-collects when the collected backup isn't in memory; delete gate checks `backup.saved` | `queue.test.ts` "re-collects after a restart…", "checks the saved backup at each delete…"; browser "a backup that was cancelled or lost to a reload…" |
| `change` forwarded an arbitrary PATCH body | Command model; body built in the service worker from the armed command | `safety.test.ts` "rejects a change that carries its own body", "writes the body of the armed command…"; `messages.test.ts` |
| Journal writes not awaited before PATCH | Serialized `createSerialPersist`; awaited intent; fail closed | `queue.test.ts` "does not send a change until its intent is durable", "fails closed…"; `storage.test.ts` "writes in call order…" |
| No cross-tab lock | Web Locks lease for the dashboard; lease port per armed run | browser "only one dashboard runs at a time…", "a lost background connection mid-run…" |
| Uncertain failures retried blindly | Probe before retry; `unknown` pauses | `queue.test.ts` "confirms an applied change after a lost response…", "retries only after…", "pauses with an unknown outcome…"; browser "an uncertain or rate-limited write…" |
| Backup was a text transcript; download not verified | JSON backup with full record, coverage, per-record hash; File System Access write read back; held chats with attachments unless accepted | `model.test.ts` "backup file…"; `queue.test.ts` "holds chats with attachments…"; browser backup tests |
| Search lost focus; preview vanished; full DOM rebuilt | Layout built once; keyed rows; preview rebuilt only for a new chat | browser "typing, selecting and filtering keep focus…" |
| Hidden selections persisted | Selection pruned on every view change; actions only reach visible chats | browser "typing, selecting and filtering…" |
| Review showed counts only | Review table of exact titles and changes; the reviewed list is the armed list | browser `reviewAndRun` assertions |
| Imported plans not validated | `validatePlan` rejects other accounts, unknown chats, stale titles, invalid actions and unknown projects | `model.test.ts` "imported plans"; browser "an imported plan…" |
| `buildJobs` accepted ids absent from inventory | Such marks are skipped and listed in the review | `model.test.ts` "builds jobs only for loaded…" |
| Per-chat mark rebuilt the DOM and wrote storage each time | `setMarks` applies a batch as one state change and one write | browser large-inventory timing |
| `checkList` compatibility flag ignored | Every row must carry the expected fields, otherwise `compat` | `model.test.ts` "rejects a page with any row…" |
| Probe read missing fields as false | `probeFromDetail` requires a recognizable record | `model.test.ts` "probes state only from…"; `api.test.ts` |
| Incomplete pagination silent | `list` reports `complete`; dashboard says only loaded chats can change | `api.test.ts` "reports a list as incomplete…" |
| Verification covered delete/archive/move only | `listedSatisfies` covers all five changes | `queue.test.ts` "re-checks renames and unarchives…" |
| Verification dropped archived chats from the inventory | Archived chats are merged back | `queue.test.ts` "keeps archived chats…" |
| Session response contained the access token | Session returns `{ accountId }` only | `safety.test.ts` "returns the account id without the bearer token" |
| Missing account id fell back to `"default"` | Session fails without an account id; journal and run are bound to it | `safety.test.ts` account tests; `storage.test.ts` "fails closed…" |
| Unreadable journal silently replaced | Decode failure switches changes off and overwrites nothing | `storage.test.ts` "fails closed…" |
| Re-arming reset attempt limits | Re-arming the same run keeps attempts and requires an identical list | `safety.test.ts` "keeps attempt counts…" |

### Found by the independent review

An independent adversarial review of the first repair found the following defects, all now fixed. Its scratch reproductions failed before the fixes and pass after them.

| Defect | Fix | Regression tests |
| --- | --- | --- |
| A pause or stop made while `start`, `resume` or a backup acknowledgement was being saved was overwritten, and changes were sent | Loop liveness also requires an active run status | `queue.test.ts` "keeps a pause made while the run's start…", "…a resume or a saved backup is being recorded" |
| A new run started while a stopped run's loop was still unwinding never ran | The queue starts the new run once that loop exits; single-request messages time out after 90 s and count as uncertain | `queue.test.ts` "starts a new run even while…" |
| A chat protected or unmarked while its run was paused was still changed | Each job checks current protection and marks before sending | `queue.test.ts` "leaves a chat alone that was protected…" |
| The crash test never restarted with an in-flight write that had already applied | Each in-flight snapshot is also restarted with the write applied, and must not resend it | `queue.test.ts` "recovers from a crash after any durable write" |
| A detected account switch left the run armed; the test claiming otherwise sent no change | The run is disarmed on any sign of another account; reads name their account | `safety.test.ts` "disarms and refuses to write…", "refuses reads for an account…" |
| A lease closed while arming still armed the guard; a lease timeout leaked its port | The lease is re-checked after the account check; the port is disconnected on failure | `safety.test.ts` "doesn't arm a run whose lease closed…" |
| Verification trusted a partial list | Every change is probed when the list is incomplete; unlisted chats stay in the inventory | `queue.test.ts` "probes every change when ChatGPT's list is incomplete…" |
| A 2xx response with a cut-off body counted as a definite failure | It counts as uncertain and is reconciled | `api.test.ts` "treats a 2xx response whose body was cut off…" |
| A paused run with an unknown outcome could be dismissed, skipping its re-check | Dismiss is unavailable until it is resumed or stopped | `queue.test.ts` "can't be dismissed while paused…" |
| A verified backup refused because the run changed during the save gave no message | The dashboard says so | Dashboard code only; not covered by a test |

`queue.test.ts` "recovers from a crash after any durable write" restarts a four-change run, including one lost response, from every journal snapshot it persisted. Each snapshot with a write in flight is restarted twice: once before ChatGPT applied the write, and once after, where it must not be sent again. Every restart must finish with all changes applied, and every write must satisfy invariants 1 and 3 against the last durable snapshot.

Mutation checks were run by hand against the queue: resuming the save phase into writing, removing the delete gate, dropping the durable intent, skipping reconciliation, letting completion overwrite a stop, and sending after a pause. Each made at least one test fail. After the review fixes, the same was done for each fix, and for removing the reconcile after a restart (the crash test's former blind spot). Mapping `saving` back to Pause/Stop failed the first browser test.

## Final qualification regressions

The baseline failed the focused queue, API, and operator cases for all six reported defects. The installed dashboard also reproduced the stale rename and Project move, the PATCH without fresh session validation, and the unnoticed session switch. The replacement-lease test failed after the first dispatch fix because a new connection could temporarily share the old run's authorization. Independent review also identified a misleading completed status after a contradictory probe, acceptance of unestablished successful HTTP statuses, and media pointers hidden in message metadata. Each has a regression case that failed before its fix.

| Defect | Regression evidence |
| --- | --- |
| Reviewed command diverges from the mark | `queue.test.ts` covers paused rename and Project edits, re-marking the identical command, and preservation of a replacement mark after a conflicting probe. The installed dashboard pauses, edits both commands, resumes and reviews the replacements in a new run. |
| Lease changes before dispatch | `safety.test.ts` holds validation between authorization and dispatch, then closes or replaces the lease. The installed dashboard closes while the real service worker awaits the routed session response and resumes only after reopening. |
| Verification fails | `queue.test.ts` restores the persisted unverified outcome and retries without writing. The installed dashboard reconciles an unfamiliar acknowledgement, survives a verification list failure and reload, then verifies the rename with one PATCH total. |
| Underlying account changes | `safety.test.ts` and the installed dashboard switch the session behind an armed run without calling the session refresh operation. Both refuse the next PATCH. |
| Backup contains potentially unrecoverable content | `queue.test.ts` holds audio, video, generated media, tool output, unknown content and nested metadata asset pointers in ordinary backup mode. Only the accompanying text-only chat enters the saved backup and reaches PATCH. A separate test adds unsupported content after the backup was written and verifies the digest check holds the delete. |
| Successful HTTP response lacks a recognized acknowledgement | `api.test.ts` rejects HTML, broken JSON, empty bodies, empty objects, redirects, 202 and 206 as uncertain. The affirmative fixture uses HTTP 200 and JSON with exactly `success: true`. The installed dashboard confirms an applied rename with an empty JSON object response by reading its detail. |

## Verification

```sh
pnpm run test --maxWorkers=1
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:browser --output="$PWD/.work/tmp/playwright-results"
pnpm run test:browser:chatgpt --output="$PWD/.work/tmp/playwright-results-chatgpt"
```

On 2026-11-22, code revision `791ff3c` passed typecheck, type-aware lint, the development build and all 406 Node tests, including 111 organizer tests. Headless Chromium on macOS passed all 16 suite browser tests and all 12 organizer browser tests.

The CI `installed-browser` job runs the organizer and suite browser fixtures. The organizer's 3,200-chat case exercises loading, selection, marking and response to keyboard input. Independent review confirmed the fixes for verification mismatches, unknown successful responses, and metadata media references. The conditional-mutation blocker below remains open.

## Unsupported and unproven

- **Attempt limits are scoped to one armed lease.** A disconnect or replacement disarms the run. Resuming opens a new lease and resets its attempt count.
- **Eventual consistency.** If ChatGPT accepts a write but a probe right afterwards still shows the old state, the queue sends the write again. All five writes set an absolute state, so a repeat converges to the same result; the attempt cap bounds repeats.
- **Media files are not fetched.** Ordinary backup holds records with attachments, non-text parts, tool output, or unfamiliar content. The original record and embedded data are preserved if the reviewer explicitly accepts incomplete recovery.
- **The fallback path relies on the user.** Where the File System Access API is unavailable, the dashboard downloads the file and the user must confirm they can see it. Nothing verifies that file.
- **The backend is a fixture.** ChatGPT's private API shapes are modelled from observed responses. The compatibility checks fail closed when the shape changes, but only real accounts reveal new shapes.
- **Browser coverage gaps.** The installed tests reopen or reload the dashboard; no ChatGPT tab is needed. Full browser-process restart with a mutation in flight remains covered by simulated journal snapshots. Token expiry is covered by the API unit tests.
- **Journal format.** The per-account `chatgpt-organizer:v2:<account>` key is unchanged. Older success labels lack durable verification evidence and become unverified on load. A previously finished run with those results offers read-only verification. Unsent jobs from an older run need a fresh review because they lack the original mark timestamp. An older in-flight intent is still reconciled. Marks under the 0.1.0 `chatgpt-triage:v1:` key remain outside this journal.

## Real-account acceptance

The owner smoke procedure uses reversible changes on test conversations and records evidence from the actual service. No live acceptance evidence has been recorded. [Owner smoke procedure](OWNER-SMOKE.md)

## Release blockers

- **Real-account contract.** Run the owner procedure and record matching active, archived and Project listings, observed response shapes, verified reversible mutations, account isolation and restart behavior.
- **Destructive endpoint contract.** Confirm the delete acknowledgment and the account-scoped detail response that proves invisibility or absence using provider documentation or existing sanitized evidence. The nondestructive smoke cannot establish these behaviors.
- **Recovery coverage.** Confirm the real detail record contains all expected branches and message metadata, that repeated reads of an unchanged conversation give stable record digests, and that ordinary backup holds media and unfamiliar shapes in sanitized fixtures captured from read-only real responses. Referenced bytes and the browser-download fallback remain limitations. A readable JSON record alone establishes neither media recovery nor the success of an unverified fallback download.
- **Concurrent native changes.** The saved digest is checked before dispatch. The service contract for a conditional PATCH against that exact revision is unverified. A native edit after the preflight read can race a delete.
- **Account identity.** Confirm the service uses distinct authenticated user IDs for the account boundaries this extension promises to enforce. Workspaces that share an ID require independent evidence of an account boundary before they can be treated as isolated.
