# Observe the X home feed and surface arthouse accounts

`x-discover` turns browser behavior into durable observations, then turns those observations into an explainable list of accounts posting about arthouse film and sharing download links. It reads your signed-in session over CDP and reuses the X Archive extension for captured GraphQL configuration. Every command also runs as `pnpm x discover <command>`.

```sh
pnpm x discover collect --feed=home-for-you --max-pages=5
pnpm x discover bootstrap
pnpm x discover enrich --handles=reverendtollerr,cleanjpg --max-pages=1
pnpm x discover derive --check-links
pnpm x discover report
pnpm x discover track
pnpm x discover follow --handles=a,b --dry-run
pnpm x discover observe
```

Every command takes `--project=NAME` (default `movies`). A project owns its topic terms, resource hosts, ledger, cache version, and output directory, so a second discovery category can be added as another JSON file under `x-discovery-core/projects`. `track` appends notable finds to `docs/x-discover/<project>/finds.jsonl`; `follow` marks that ledger after X confirms a follow.

`collect` starts a new observation run at the head of the selected feed. It commits each page transactionally to `discovery.db`: canonical post versions keyed by tweet id and content hash, per-run appearances with entry position and attribution, the continuation checkpoint, entry accounting, and the raw response for later re-parsing. A second run for the same account is refused until the first ends. All runs are bound to the account read from the browser; a changed account stops the run before anything is saved.

`bootstrap` extracts candidate authors from your existing bookmarks and likes archives. `enrich` samples a bounded number of profile pages for named candidates so an account's normal posting mix can be judged separately from what your feed happened to surface. `derive` reads saved posts and writes `topics.json`, `links.json`, and `accounts.json`; results are cached by content hash and derivation version, so re-running does not redo work. `--check-links` probes up to three resource links with a separate budget. `report` prints the ranked accounts with source URLs, role, evidence, and uncertainty.

`observe` re-opens the home page, records initial, continuation, and fresh-run requests, and writes sanitized observations plus a derived request recipe under `outDir/observations` and `outDir/recipes`. Recipes name caller inputs, response dependencies, captured configuration, session material, and application-generated values. The checked-in recipes live in `x-client-core/recipes`.

The parser accounts for every timeline entry. Posts, cursors, promoted items, unavailable tweets, and unknown modules are counted; a module carrying posts that no decoder understands fails the page instead of silently dropping those posts. Classification separates three judgments: topic relevance, account consistency, and resource links. Posts with too little text return `insufficient_evidence` rather than a guess.

Press Ctrl-C to stop after the current page. The exit code is 130; a second Ctrl-C forces exit. Saved pages, appearances, and checkpoints are kept. A new scheduled run starts at the head of the feed rather than treating an all-known page as proof the feed is exhausted.

`--out DIR` selects the output directory (default `~/.local/share/x/discovery`, or `X_DISCOVERY_OUT`). `--cdp-url`, `--backend`, and `--session` select the browser session.
