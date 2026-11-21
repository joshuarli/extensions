# ChatGPT Organizer

A separately installable Manifest V3 extension for reviewing and bulk-organizing ChatGPT conversations. It is a port of [Triage](https://github.com/NASIRCISSISTIC/chatgpt-triage) by Nasir Yar Khan ([@NASIRCISSISTIC](https://x.com/NASIRCISSISTIC)), preserved under the upstream [MIT license](LICENSE).

- **Upstream revision:** `4eec2dfb248ab62b3ff8a9c42f2ac6f88f1216b8` (`main`, 2026-11-21).
- This is not a wrapper around the upstream userscript. The behavior is reimplemented as typed modules; the 3,700-line monolith is not retained.

## Install

This extension is built separately from `extension-suite` so that private conversations and irreversible deletion do not share a security boundary with the other features.

1. Run `pnpm run build` (development) or `pnpm run dist` (production).
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `build/extension-chatgpt` or `dist/extension-chatgpt`.
4. Sign in at [chatgpt.com](https://chatgpt.com). Click the toolbar icon to open the dashboard.

## Architecture

```
dashboard.html/.ts/.css  full-page review UI (filters, multi-select, preview, queue)
        ↕ chrome.tabs.sendMessage, Schema-validated messages
service-worker.ts        opens the dashboard; owns no long-running loops
        ↕ chrome.storage.local (account-scoped) + chrome.tabs
content.ts               isolated content script on chatgpt.com; ephemeral token only
        ↕ same-origin fetch
ChatGPT web backend      undocumented, untrusted, subject to change
```

- `api.ts` — paced, typed client. Handles `429` with `Retry-After` and a cooldown ladder, refreshes the token once on `401`/`403`, retries transient errors, and refuses unfamiliar response shapes before any mutation.
- `queue.ts` — resumable operation state machine. One change at a time, backup before deletion, protected chats, held chats that could not be backed up, reconciliation after interruption, and a direct re-check of suspicious changes at the end of a run.
- `storage.ts` — Schema-validated, per-account journal of marks, protections, settings and run state.
- `messages.ts` — Schema-validated message and wire contracts.
- `safety.ts` — the destructive-action guard. The content script is **disarmed by default**; the dashboard must send an `arm` message with the exact job list after confirmation. Every `change` is checked against that list (id, action, run id, attempt cap) and an unarmed change is refused with no request sent. This is a second gate independent of the queue.

The authenticated client runs in Chrome's **isolated** content-script world, not the page's `MAIN` world. The access token is held in memory only; conversation bodies are not persisted by default. The journal stores metadata and operation state, never ChatGPT's `localStorage`.

`extension-chatgpt` requests only `storage` and `https://chatgpt.com/*`. It requests no `cookies`, `webRequest`, `debugger`, `<all_urls>`, remote scripts, or telemetry. A security test enforces this contract.

## Behavior carried over from Triage

- Read a conversation before marking it; keyboard navigation, range selection and protected chats.
- Mark delete, archive, unarchive, rename, move into a project, or protect.
- Projects live in their own filter so a cleanup cannot empty a project by accident.
- Rate-limit pacing, one-change-at-a-time writes, token refresh, and a backup that must be saved before any deletion starts.
- Verification re-reads the list and probes suspicious chats directly; a change that cannot be confirmed is marked again rather than silently accepted.
- Marks and run state survive restarts; an interrupted run requires deliberate resumption and reconciles the in-flight change before repeating it.

## Deliberate differences

- The dashboard is a full extension tab (three columns) instead of an injected panel. A native side panel is not part of this milestone.
- The journal is extension-owned storage per account rather than page `localStorage`.
- The runner is driven by the dashboard page, not a service worker, because MV3 workers are not persistent job runtimes.
- Importable JSON change plans and exportable reports replace Triage's console-only mock flows. The demo's hard cases are covered by Vitest instead of browser URL flags.

## Tests

- `pnpm exec vitest run extension-chatgpt/test --maxWorkers=1` covers the API client, queue state machine, storage, message contracts, model helpers and the security boundary. `test/safety.test.ts` proves that an attempt to delete all 200 chats is refused for the 198 unmarked ones, and that the guard starts disarmed.
- `pnpm run build && pnpm run test:browser:chatgpt` installs the built extension in Chromium and drives a routed fake `chatgpt.com`. It proves an unarmed delete is refused at the installed boundary and that only an explicitly armed chat is deleted.

ChatGPT uses private, undocumented web endpoints. OpenAI can change them at any time. Deletion is permanent; turn on the backup and review the queue before running it. This project is not affiliated with or endorsed by OpenAI.
