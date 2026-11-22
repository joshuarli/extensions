# ChatGPT Organizer

A feature of the unified [Browser Extensions](../README.md) Manifest V3 extension (the suite) for reviewing and bulk-organizing ChatGPT conversations. It is a port of [Triage](https://github.com/NASIRCISSISTIC/chatgpt-triage) by Nasir Yar Khan ([@NASIRCISSISTIC](https://x.com/NASIRCISSIC)), preserved under the upstream [MIT license](LICENSE).

- **Upstream revision:** `4eec2dfb248ab62b3ff8a9c42f2ac6f88f1216b8` (`main`, 2026-11-21).
- This is not a wrapper around the upstream userscript. The behavior is reimplemented as typed modules; the 3,700-line monolith is not retained.

## Install and open

This is not a separately installable extension. It is composed into `extension-suite` like every other `extension-*` package.

1. Run `pnpm run build` (development) or `pnpm run dist` (production).
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `build/extension-suite` or `dist/extension-suite`.
4. Sign in at [chatgpt.com](https://chatgpt.com). Open the toolbar popup and choose **Open organizer** under **ChatGPT Organizer**.

## Architecture

```
dashboard.html/.ts/.css  full-page review UI (filters, multi-select, preview, queue)
        ↕ chrome.tabs.sendMessage, Schema-validated messages
content.ts               isolated content script on chatgpt.com; ephemeral token only
        ↕ same-origin fetch
ChatGPT web backend      undocumented, untrusted, subject to change

background.ts            opens the dashboard from the suite popup; no global listeners
manifest.fragment.ts     contributes the content script, host access and storage permission
```

- `api.ts` — paced, typed client. Handles `429` with `Retry-After` and a cooldown ladder, refreshes the token once on `401`/`403`, and refuses unfamiliar list rows and conversation records. It keeps the bearer token to itself.
- `operator.ts` — the content script's request handler. Each run is armed with an exact command per chat (`delete`, `archive`, `unarchive`, `rename` to a title, `move` to a project) for one account, and only while the dashboard holds that run's lease port. A `change` identifies the chat, run, account and lease. The content script builds the PATCH body from the armed command.
- `safety.ts` — the guard behind `operator.ts`. It starts disarmed, refuses a second run while one is armed, and caps attempts per chat.
- `queue.ts` — resumable state machine. The queue saves the intent before sending each write and checks uncertain responses with ChatGPT before retrying. Deletes wait for a saved backup, chats that couldn't be backed up are held, and the end of a run re-checks every acknowledged change. If it cannot confirm the results, use **Retry verification** to check them again without sending another change.
- `storage.ts` — Schema-validated, per-account journal with serialized writes. A journal it can't read switches changes off instead of being replaced.
- `messages.ts` — Schema-validated message and wire contracts.

Only one dashboard runs at a time: each holds a Web Lock, and a second tab waits for the first to close.

The authenticated client runs in Chrome's **isolated** content-script world, not the page's `MAIN` world. The access token is held in memory only; conversation bodies are not persisted by default. The journal stores metadata and operation state, never ChatGPT's `localStorage`.

This feature's manifest fragment adds only `storage` and `https://chatgpt.com/*` to the suite. It adds no `cookies`, `webRequest`, `debugger`, `<all_urls>`, remote scripts, or telemetry. A security test enforces this contract.

## Behavior carried over from Triage

- Read a conversation before marking it; keyboard navigation, range selection and protected chats.
- Mark delete, archive, unarchive, rename, move into a project, or protect.
- Projects live in their own filter so a cleanup cannot empty a project by accident.
- Rate-limit pacing, one-change-at-a-time writes, token refresh, and a backup that must be saved before any deletion starts. The backup is a JSON file with each chat's full record (all branches and metadata). It is written through a file handle and read back to check its hash. Ordinary backup keeps chats with attachments, media, tool output or unfamiliar content whose recovery it cannot establish. The review has a separate opt-in for incomplete backups.
- Verification reads each changed chat directly. The reviewed mark remains until the change is verified. Unavailable checks pause the run, and contradictory results need attention.
- Marks and run state survive restarts; an interrupted run requires deliberate resumption and reconciles the in-flight change before repeating it.

## Deliberate differences

- The dashboard is a full extension tab (three columns) instead of an injected panel. A native side panel is not part of this milestone.
- The journal is extension-owned storage per account rather than page `localStorage`.
- The runner is driven by the dashboard page, not a service worker, because MV3 workers are not persistent job runtimes.
- Importable JSON change plans (checked against the signed-in account and loaded chats) and exportable reports replace Triage's console-only mock flows. The demo's hard cases are covered by Vitest instead of browser URL flags.

## Tests

- `pnpm exec vitest run extension-chatgpt/test --maxWorkers=1` covers the API client, the content-script boundary and guard, the queue (including a restart from every durable state of a run), storage, message contracts and model helpers.
- `pnpm run build && pnpm run test:browser:chatgpt` installs the built suite in Chromium and drives its organizer dashboard against a routed fake `chatgpt.com`. It covers backup-gated deletion, cancelled and reloaded backups, lost responses and rate limits, a ChatGPT tab reload mid-run, two dashboards, focus and selection behavior, plan import, and a 3,200-chat account. CI runs it.

[QUALIFICATION.md](QUALIFICATION.md) lists the safety invariants, fixed defects and their tests, remaining limits, and release blockers.

ChatGPT uses private, undocumented web endpoints. OpenAI can change them at any time. Deletion is permanent; turn on the backup and review the queue before running it. This project is not affiliated with or endorsed by OpenAI.
