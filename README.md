# Browser extensions

This repository contains the custom Chromium Manifest V3 extensions under one
shared pnpm, Deno, TypeScript 7, Vite 8, and Oxlint setup.

Each extension follows the same package shape:

```text
extension-*/
├── src/       # manifest, service worker, UI, injected code, and assets
└── test/      # package-local unit and browser tests
```

Every extension names its background entrypoint `src/service-worker.ts` and
builds it as `service-worker.js`. Runtime-specific injected scripts remain
separate bundles where the browser requires classic scripts.

Install the pinned pnpm CLI with Deno, then install the shared dependencies:

```bash
deno task bootstrap
pnpm install
```

Use the root scripts for project tasks:

```bash
pnpm run dev          # build Loupe's WASM bindings and watch extension sources
pnpm run build        # build development extension bundles
pnpm run dist         # build production extension bundles
pnpm run test         # run unit tests
pnpm run test:browser # run browser tests with Chromium
pnpm run check        # run lint, typecheck, and unit tests
```

Use `make install` on macOS to open Helium's extensions page and build production
bundles. Load the directories under `dist/` as unpacked extensions.
