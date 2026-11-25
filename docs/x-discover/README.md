# X discovery projects

Each discovery category is an isolated project. The checked-in project files live in `x-discovery-core/projects/<id>.json` and define the topic terms, negative patterns, resource hosts, ledger path, and cache version for that category. The `movies` project finds arthouse and rare-film posts; add another JSON file to discover a different category without changing the SDK.

Outputs are isolated too: `~/.local/share/x/discovery/<project>/` holds the SQLite store, `topics.json`, `links.json`, `accounts.json`, and `candidates.json` for that project. Caches are keyed by the project version and an algorithm version, so changing one project's terms does not invalidate another's work, and a corrected post or a changed author attribution invalidates a stale derivation.

## What is finished and what is not

- **Finished:** a handwritten TypeScript client (`x-client-core`) that captures operations from the browser, preserves each operation's method and configuration, executes requests with schema-decoded credentials, and reobserves a captured home operation once if X rejects it.
- **Prototype:** `x discover observe` and `deriveRecipe()` produce descriptive JSON that classifies request values and records observation steps. The runtime does not execute those JSON files and does not regenerate the client automatically; an unverified continuation is reported as incomplete rather than labeled from a fresh page. Treat the checked-in recipes as documentation plus fixtures, not as executable maintenance.
- **Evaluated:** the movies topic judgment is guarded by `x-discovery-core/test/fixtures/movies-eval.json`, a small labeled set covering genuine finds, misleading technical vocabulary, handles and URLs, image-only posts, and resource posts.

## Ledger

`docs/x-discover/<project>/finds.jsonl` is the durable record of notable posts. Each line is a `FindRecord`: tweet id, author id and handle, source URL, topic score, resource links, a note, discovery time, and `seen` or `followed` status. `x discover track` reads every relevant or resource-bearing post in the store and appends new finds without duplicating tweet ids; the three-example cap in account findings is display-only. Delete nothing from this file unless the find was wrong; rerunning `derive` and `track` is safe.

## Follow

`x discover follow --handles=a,b` resolves each handle, checks the live `following` state before trusting the ledger, and marks the ledger after X confirms the follow. `--dry-run` reports decisions without following or writing. The action uses the observed `friendships/create.json` endpoint with the live session's CSRF token and web app bearer token; it never stores cookies on disk.

## Failure semantics

A page whose post-bearing entries cannot be decoded is saved with its reason and the last good checkpoint is kept; it is never reported as `timeline_complete`. Observations record the original entry identity, page, and position, so a post appearing twice is two appearances. A job lease is renewed before each page, and a run whose lease was taken over stops instead of committing more pages.

## Commands

```sh
pnpm x discover collect --project=movies --max-pages=10
pnpm x discover derive --project=movies --check-links
pnpm x discover report --project=movies
pnpm x discover track --project=movies
pnpm x discover follow --project=movies --handles=ElEmNOPIi,NeilBahadur --dry-run
pnpm x discover bootstrap --project=movies
pnpm x discover enrich --project=movies --handles=someone,another --max-pages=1
pnpm x discover observe --operation=HomeTimeline
```

The same commands are available as `pnpm x:discover <command>`. `collect` starts at the head of the feed and commits each page transactionally. `derive` and `track` read saved posts, so repeated runs do not refetch X.
