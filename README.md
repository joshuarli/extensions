# Browser extensions

This repository contains the custom Chromium Manifest V3 extensions under one
shared Deno, TypeScript 7, Vite 8, and Oxlint setup.

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
deno task dev          # build Loupe's WASM bindings and watch extension sources
deno task build        # build development extension bundles
deno task dist         # build production extension bundles
deno task test         # run unit tests
deno task test:browser # run browser tests with Chromium
deno task check        # run lint, typecheck, and unit tests
```

Use `make install` on macOS to open Helium's extensions page and build production
bundles. Load the directories under `dist/` as unpacked extensions.
