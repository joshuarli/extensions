# ChatGPT Organizer qualification

This record covers the safety repair that followed the review of `31528575` (version 0.1.0). It lists the safety invariants, the defects that were fixed and the tests that cover them, how to rerun the checks, and what remains unproven.

## Safety invariants

1. **Backup before deletion.** When backup protection is on, a delete is sent only if the journal's durable `run.backup.saved.ids` contains that chat. A file write that was read back and hash-checked, or an explicit confirmation on the fallback path, sets that field. The queue checks it before every delete, whatever the run's phase or status.
2. **Exact authorization.** The content script sends a PATCH only for a chat in the armed run, for the armed account, with the body derived from that chat's armed command. The `change` message carries no body. A run can be armed only while the dashboard holds the run's lease port open, and closing the port disarms it.
3. **Intent before send.** `run.inflight` is durably saved before each PATCH. If saving fails, the run pauses and nothing more is sent.
4. **Reconcile, then retry.** After a network error, 5xx or lost tab response, the queue probes the chat before sending again. If the probe can't decide, the run pauses with an `unknown` outcome, and the next resume probes again first.
5. **One runner.** A dashboard holds a Web Lock for its lifetime. A second dashboard waits and loads the journal only once the first closes.
6. **Pause and stop hold.** A loop step changes the run only while its abort signal is live, so a late completion records its outcome and never overwrites a pause or a stop.
7. **Credentials stay in the content script.** The session response carries the account id only. The extension requests only `storage` and `https://chatgpt.com/*`.

## Fixed defects and regression tests

Unit tests are in `test/`. Browser tests are in `test/browser/extension-runtime.spec.ts` and drive the real dashboard against the routed fake backend in `test/browser/fake-chatgpt.ts`.

| Defect | Fix | Regression tests |
| --- | --- | --- |
| Backup save button unreachable; `saving` showed Pause/Stop | `runControls()` maps each status to exactly one control set | `model.test.ts` "maps every run status…"; browser "deletes only after a verified backup…" |
| Resuming in phase `save` deleted without a saved backup | Resume re-collects when the collected backup isn't in memory; delete gate checks `backup.saved` | `queue.test.ts` "re-collects after a restart…", "checks the saved backup at each delete…"; browser "a backup that was cancelled or lost to a reload…" |
| `change` forwarded an arbitrary PATCH body | Command model; body built in the content script from the armed command | `safety.test.ts` "rejects a change that carries its own body", "writes the body of the armed command…"; `messages.test.ts` |
| Journal writes not awaited before PATCH | Serialized `createSerialPersist`; awaited intent; fail closed | `queue.test.ts` "does not send a change until its intent is durable", "fails closed…"; `storage.test.ts` "writes in call order…" |
| No cross-tab lock | Web Locks lease for the dashboard; lease port per armed run | browser "only one dashboard runs at a time…", "a ChatGPT tab reload mid-run…" |
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

`queue.test.ts` "recovers from a crash after any durable write" restarts a four-change run, including one lost response, from every journal snapshot it persisted. Every restart must finish with all changes applied, and every write must satisfy invariants 1 and 3 against the last durable snapshot.

Mutation checks were run by hand against the queue: resuming the save phase into writing, removing the delete gate, dropping the durable intent, skipping reconciliation, letting completion overwrite a stop, and sending after a pause. Each made at least one test fail. Mapping `saving` back to Pause/Stop failed the first browser test.

## Verification

```sh
pnpm exec vitest run extension-chatgpt/test --maxWorkers=1
pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run test:browser:chatgpt
```

The CI `installed-browser` job runs the browser suite. On 2026-11-21 (macOS, headless Chromium) all 72 unit tests and all 8 browser tests passed, and the browser suite took 2.5 minutes. With 3,200 generated chats (about 2,900 active rows), moving focus cost 5.6 ms and selecting plus marking cost 20 ms. At that cost the list does not need virtualization.

## Unsupported and unproven

- **Attempt limits reset when the ChatGPT tab reloads.** The guard lives in content-script memory. A reload disarms the run, which then needs a deliberate resume.
- **Eventual consistency.** If ChatGPT accepts a write but a probe right afterwards still shows the old state, the queue sends the write again. All five writes set an absolute state, so a repeat converges to the same result; the attempt cap bounds repeats.
- **Attachment and image files are not backed up.** The backup holds their ids only. Such chats are held unless the reviewer ticks the second box in the review dialog.
- **The fallback path relies on the user.** Where the File System Access API is unavailable, the dashboard downloads the file and the user must confirm they can see it. Nothing verifies that file.
- **The backend is a fixture.** ChatGPT's private API shapes are modelled from observed responses. The compatibility checks fail closed when the shape changes, but only real accounts reveal new shapes.
- **Not tested end to end:** browser restart with a run in flight (covered at unit level by the crash test), token expiry inside the installed extension (covered by `api.test.ts`), and account switching inside the installed extension (covered by `safety.test.ts`).
- **Journal format.** The journal moved to key `chatgpt-organizer:v2:<account>`. Marks stored by 0.1.0 under `chatgpt-triage:v1:` are left in place but not read.

## Real-account smoke test (nondestructive)

1. Run `pnpm run build`, load `build/extension-chatgpt`, sign in at chatgpt.com and open the dashboard.
2. Confirm that the chat count matches the sidebar and that no "only loaded chats can be changed" notice appears.
3. Read several chats in the preview with `j`/`k`, search with `/`, and switch Active/Archived and project filters.
4. Mark a chat with **Rename** to a temporary title, review it, run it, and check the title in ChatGPT. Rename it back the same way.
5. Archive one chat, check that it appears under Archived in ChatGPT, then **Unarchive** it.
6. Open a second dashboard tab and confirm that it waits.
7. Export a plan, then import it again.

Do not delete real chats as part of qualification.

## Release blockers

- The smoke test above has not been run against a real account.
- The backup format and probe rely on the fields `mapping`, `is_archived`, `is_visible`, `gizmo_id` and `conversation_template_id`. Confirm these on a real account before the first real delete.
