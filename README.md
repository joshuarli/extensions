# Browser extensions

This repository contains the custom Chromium Manifest V3 extensions under one
shared Deno, TypeScript, Rolldown, Oxfmt, and Oxlint setup.

Each extension follows the same package shape:

```text
extension-*/
├── src/       # manifest, service worker, UI, injected code, and assets
└── test/      # package-local unit and browser tests
```

Every extension names its background entrypoint `src/service-worker.ts` and
builds it as `service-worker.js`. Runtime-specific injected scripts remain
separate bundles where the browser requires classic scripts.

Install the shared dependencies with `deno install`, then use the root tasks:

```bash
make install       # build all production bundles and show their unpacked paths
deno task test     # build Loupe's WASM bindings and run every test suite
deno task check    # check formatting, lint, and TypeScript without changing files
```

`make install` opens the extensions page in Helium.
