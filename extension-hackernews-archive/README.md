# Hacker News thread archive

Open an item page on news.ycombinator.com in the unified extension and click **Archive thread**. The download is named `hn-<root-id>.html` (existing downloads are uniquified). A comment or poll-option permalink resolves to the containing submission. No sign-in, cookies, content script, or CDP connection is required.

Terminal equivalents:

```sh
pnpm hn https://news.ycombinator.com/item?id=8863 --out hn-8863.html
pnpm tools hn 8863 --format json --out hn-8863.json
```

Omit `--out` to write to stdout; existing output files are not overwritten. Exit status 2 means invalid arguments; 1 means capture or output failure.

The shared core uses the [official public HN API](https://github.com/HackerNews/API), follows every returned comment edge and poll option, preserves ranked sibling ordering and parent relationships, and records deleted/dead items when returned by the API. HTML is self-contained and contains the versioned JSON snapshot in `script#hn-archive[type="application/json"]`. Only a small formatting vocabulary and HTTP(S) links are reconstructed; no page scripts, remote images, or resources are loaded on open.

This is an observed public API snapshot, not an atomic historical snapshot or a copy of the linked article. Comments that arrive during capture or are absent from the API cannot be guaranteed. Missing/malformed referenced items, cycles and inconsistent relationships fail the capture instead of writing a misleading partial archive. The traversal is bounded to 10,000 records, eight concurrent requests, a 15-second request timeout and a two-minute overall fetch deadline; transient HTTP errors are retried once. Keep the popup open to see capture errors.

The suite uses the existing offscreen blob transport for downloads. Run `make dist` to build the updated suite and refresh the generated embedded runtime assets before installing or hot-loading it.
