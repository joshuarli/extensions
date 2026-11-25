# X discovery projects

Each discovery category is an isolated project. The checked-in project files live in `x-discovery-core/projects/<id>.json` and define the topic terms, resource hosts, ledger path, and cache version for that category. The `movies` project finds arthouse and rare-film posts; add another JSON file to discover a different category without changing the SDK.

Outputs are isolated too: `~/.local/share/x/discovery/<project>/` holds the SQLite store, `topics.json`, `links.json`, `accounts.json`, and `candidates.json` for that project. Caches are keyed by the project version, so changing one project's terms does not invalidate another's work.

## Ledger

`docs/x-discover/<project>/finds.jsonl` is the durable record of notable posts. Each line is a `FindRecord`: tweet id, author id and handle, source URL, topic score, resource links, a note, discovery time, and `seen` or `followed` status. `x discover track` reads the project's derived files and appends new finds without duplicating tweet ids. Delete nothing from this file unless the find was wrong; rerunning `derive` and `track` is safe.

## Follow

`x discover follow --handles=a,b` resolves each handle, skips accounts already followed, and marks the ledger after X confirms the follow. `--dry-run` reports the decision without following. The action uses the observed `friendships/create.json` endpoint with the live session's CSRF token and web app bearer token; it never stores cookies on disk.

## Commands

```sh
pnpm x discover collect --project=movies --max-pages=10
pnpm x discover derive --project=movies --check-links
pnpm x discover report --project=movies
pnpm x discover track --project=movies
pnpm x discover follow --project=movies --handles=ElEmNOPIi,NeilBahadur --dry-run
pnpm x discover bootstrap --project=movies
pnpm x discover enrich --project=movies --handles=someone,another --max-pages=1
```

The same commands are available as `pnpm x:discover <command>`. `collect` starts at the head of the feed and commits each page transactionally. `derive` and `track` read saved posts, so repeated runs do not refetch X.
