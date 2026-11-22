# Qualify the organizer on real accounts

Use an unpacked build from the candidate commit and a dedicated Chromium profile. Use two test accounts with distinct sign-ins. Create clearly named test conversations and two test Projects that you can leave in place. Use reversible changes only and leave **Delete** unmarked throughout.

## Check the session and inventory

1. Run `pnpm run build`, load `build/extension-chatgpt`, and sign in to the first test account. Open ChatGPT DevTools on the Network panel and enable **Preserve log**.
2. Open the organizer. Compare its Active and Archived inventories against the native UI while the account is idle. Check counts, unique conversation IDs, and representative entries from the start and end of each list. Check one account with enough conversations to require a second page before accepting pagination.
3. Confirm that each list exhausts its pages and that any reported total matches the unique record count. Record any missing-conversation signal from ChatGPT or incomplete-inventory warning from the organizer. Compare Project names and representative assigned and unassigned conversations against ChatGPT.
4. Open the preview of a text-only test conversation and of a test conversation containing media. Inspect their detail response in DevTools. Check `mapping` against the expected branches, and record field presence and types for `title`, `is_archived`, `is_visible`, `gizmo_id` and `conversation_template_id`. Record the content types, part types, tool roles and attachment metadata shape without copying message text or asset URLs. Reload the organizer without editing either chat. Open both previews again and record any fields that differ in the new detail responses.

## Check reversible writes

1. On one test conversation, review and run a rename to a temporary title. Confirm both the native title and the organizer's **verified** result, then rename the conversation back through the organizer.
2. Start with an unassigned test conversation. Move it into the first test Project, then into the second, then back to **No Project**. After each run, compare the native Project membership with the detail response and the organizer's result.
3. Archive a test conversation, verify that it appears in Archived in both interfaces, then unarchive it and verify that it returns to Active.
4. For each action, record the PATCH status, redirect behavior, content type, and JSON field names and types. Check the follow-up detail response against the intended state. If an acknowledgement differs from HTTP 200 with a JSON object containing only a Boolean `success` field, record whether the organizer reconciled it or left it unverified. Treat a new shape as open contract evidence even if reconciliation succeeded.

## Check account isolation and restart

1. In the first account, review two temporary renames with a 120-second gap. After the first PATCH is confirmed and while the second is queued, switch the underlying ChatGPT sign-in to the second account without refreshing the organizer.
2. Confirm that the old dashboard pauses, that the second PATCH is absent, and that the second account shows only its own journal and inventory when you reopen the organizer. If the sign-in switch reloads the ChatGPT tab, record that fact alongside the result. The installed fixture separately checks a switch with the content script still connected.
3. Switch back to the first account and reopen the organizer. If it reports the account change, reload the organizer once to bind it to the current session. Check the two conversations in ChatGPT. Stop the old run before reviewing any restoration changes.
4. In the first account, review two reversible changes with a 120-second gap. Close Chromium after the first PATCH reaches ChatGPT and while the second change is still queued. Restart with the same profile.
5. Confirm the organizer displays the interrupted run as paused. Check both conversations in native ChatGPT before pressing **Resume**. Confirm that no PATCH occurs before Resume, the first write is verified without a repeat, and the second runs once. Restore both conversations to their original states.

## Record the result

Record the candidate commit, browser version, date, per-scope listing counts, response shapes, observed verification outcomes, and any mismatches. Use aliases for accounts, conversations and Projects. Omit tokens, cookies, raw headers, message content, attachment URLs and full network exports. Record any cases you could not exercise and keep their release blockers open.
