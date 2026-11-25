# Enumerate arthouse accounts from your X home feed

`x-discover` reads your signed-in X home feed over CDP, saves every organic post, and derives a ranked list of accounts posting about arthouse film and sharing download links. It reuses the session and credential capture from `x-archive-cli`; it does not store cookies on disk.

Run it against your signed-in Helium:

```sh
pnpm x:discover
```

The first run opens `https://x.com/home` once so the X Archive extension captures the `HomeTimeline` query ID, features and bearer token. Later runs read the cached credentials. Use `--cdp-url` to attach elsewhere, `--max-pages N` to bound a run, and `--out DIR` to choose where data lands.

```sh
pnpm x:discover --cdp-url http://127.0.0.1:9222 --max-pages 50 --out ~/.local/share/x/discovery
```

The run stops at the page limit or at the end of the feed. It saves the cursor after each page, so a later run resumes from that point and `appendNewPosts` skips tweets already on disk. Press Ctrl-C once to stop after the current page; the exit code is 130.

## Output

`posts.jsonl` holds one `DiscoveredPost` per line: tweet id, author id and handle, created time, full text, expanded URLs, metrics and observation time. Nothing is rewritten after collection. `signals.json` holds one `PostSignal` per post with an arthouse score, matched terms and extracted drive links. `accounts.json` ranks accounts by total score and link count, with up to three sample links each.

Because derivation reads the raw posts, you can change the weights in `x-discovery-core/src/classifier.ts` and regenerate `signals.json` and `accounts.json` without touching X. A changed response shape stops collection with reason `unexpected_shape` instead of returning an empty feed; re-record the operation by reloading x.com in Helium.

`X_DISCOVERY_CDP_URL`, `X_DISCOVERY_OUT` and `XDG_DATA_HOME` override the defaults. `X_ARCHIVE_DEBUG=1` prints GraphQL status and URL (without secrets) for API-drift debugging.
