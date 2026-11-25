# EXT-26: Keep real X discovery finds out of the public repository

Status: draft

## Summary

Replace the committed discovery ledger with synthetic fixtures, keep real ledgers outside the repository, and decide whether the existing entries must be purged from git history.

## Motivation

`docs/x-discover/movies/finds.jsonl` holds 17 real finds with third-party handles, numeric author IDs, tweet IDs, verbatim post text, resource links, and follow timestamps. `docs/x-discover/README.md:15` calls that file the durable record and says to delete nothing from it, and the `track` and `follow` commands write to it, so normal use keeps appending real data. `TODO.md` states that this repository is public and requires synthetic fixtures. The exposure grows with every run.

## Design

Replace the checked-in ledger with synthetic `FindRecord` lines that exercise the same fields. Ignore real `docs/x-discover/*/finds.jsonl` files so local runs cannot commit them by accident. Point the project's ledger path at local state under `~/.local/share/x/discovery/<project>/`, and update the ledger section of the README to describe the local record and the checked-in fixtures. The sample follow command already uses synthetic handles.

Git history still contains the original entries. Removing them from history is a separate, owner-authorized operation.

## Alternatives considered

Keep the real ledger as the durable record: continues publishing third-party activity. Encrypt the file: adds key management and still publishes ciphertext with no clear benefit. Rewrite git history: removes the content from current branches but needs coordination with anyone holding a clone, so it is an owner decision. Move the ledger to a private repository: changes the tool's storage contract and needs owner setup.

## Open questions

Whether to rewrite git history, given existing clones. Which accounts and posts are affected and whether notice is required. Where the real ledger should live after the change. Whether `track` and `follow` should keep writing to a project-local file or to the shared discovery state directory.

## Decision

Pending owner. No data or history changes are authorized by this draft.
