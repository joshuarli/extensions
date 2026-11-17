# Onefile CLI

Save a web page from the terminal as the same universal self-extracting `.u.zip.html` archive as the Onefile extension:

```sh
pnpm onefile save https://example.com/
pnpm onefile save https://example.com/ --out ./saved
pnpm onefile save https://example.com/ --backend=bctl --session onefile
pnpm onefile save https://example.com/ --cdp-url http://127.0.0.1:9222
```

The command opens a new tab, waits for load, captures the page, writes the archive, prints its path, and closes that tab. An existing file is never overwritten. Missing resources are recorded in the archive banner and `metadata.json` and reported on stderr. See [the format](../extension-onefile/FORMAT.md) for viewing and extraction details.

The default output directory is `~/.local/share/onefile`. `XDG_DATA_HOME` changes the base directory; `ONEFILE_OUT` sets the directory directly; `--out` takes precedence over both.

The default browser backend attaches to Helium at `http://127.0.0.1:9222`. `--cdp-url` or `ONEFILE_CDP_URL` attaches to another CDP endpoint. `--backend=bctl` launches or reuses a bctl appliance and obtains its CDP URL; `--session` selects the session (default `onefile`). `ONEFILE_BACKEND`, `ONEFILE_SESSION`, and `ONEFILE_BCTL` set the backend, session, and bctl executable. An explicit CDP URL takes precedence over launching bctl. Run `pnpm onefile --help` for the command reference.
