# Repository guide

This repository builds one Chromium Manifest V3 extension from four feature packages with shared TypeScript and Vite tooling.

## Commands

- Install the pinned pnpm CLI with Node.js: `npm install --global pnpm@11.0.2`
- Install dependencies: `pnpm install`
- Check types and unit tests: `pnpm run check`
- Build development or production bundles: `pnpm run build` or `pnpm run dist`
- Run browser tests: `pnpm run test:browser`

## Invariants

- Service workers are ES modules; scripts injected into pages are classic bundles.
- Feature packages expose background handlers and manifest fragments; only the suite registers global Chrome listeners and owns the manifest, popup, and options page.
- Shared extension-page helpers and delayed action-state guards live in `lib/`; domain logic stays in its feature package.
- Keep extension UI in native TypeScript, DOM, and CSS.
- Use Effect 4 for extension I/O and typed failures; use Schema at network, storage, and message boundaries.
- Do not run pre-commit hooks.

## Topics

- Shared setup, builds, and tests: [docs/development.md](docs/development.md)
- Suite composition, manifest, and worker: [extension-suite](extension-suite)
- Shared extension-page helpers: [lib](lib)
- Allow Right-Click architecture: [docs/allow-right-click.md](docs/allow-right-click.md)
- YouTube user and message API: [extension-youtube-transcript/README.md](extension-youtube-transcript/README.md)
- X Bookmarks collection/export: [extension-x-bookmarks/README.md](extension-x-bookmarks/README.md)
- Onefile save and format: [extension-onefile/README.md](extension-onefile/README.md), [extension-onefile/ARCHITECTURE.md](extension-onefile/ARCHITECTURE.md), [extension-onefile/FORMAT.md](extension-onefile/FORMAT.md)

## Verification

- `make test` typechecks and runs all Node Vitest tests; `make lint` typechecks only. Costs: unmeasured; see [Ground](docs/deslop-ground.md).
- `make test TEST_ARGS=--maxWorkers=1` bounds Vitest workers; browser tests are separate (`pnpm run test:browser`).
- Suite manifest and bundle shape: `extension-allow-right-click/test/extension-contract.test.ts`; suite messages: `extension-suite/test/message-contract.test.ts`.
- Right-click page behavior: `extension-allow-right-click/test/user-select-restoration.browser.test.ts` (excluded from Node suite); real extension runtime: none.
- YouTube messages: `extension-youtube-transcript/test/message-contract.test.ts`; HTTP and transcript parsing: `http.test.ts`, `transcript.test.ts` in that test directory.
- Onefile capture messages: `extension-onefile/test/message-contract.test.ts`; ZIP and HTML formats: `zip.test.ts`, `polyglot.test.ts`, `archive-integrity.test.ts`; Chromium capture: `test/browser/capture.spec.ts`.
- X GraphQL request and response handling: `extension-x-bookmarks/test/api.test.ts`, `parser.test.ts`, `capture.test.ts`; IndexedDB archive state: `storage.test.ts`, `likes.test.ts`, `profile.test.ts`.
- X CLI flags and exit codes: none at process boundary; backend selection: `x-archive-cli/test/backend.test.ts`; filesystem state: `fs-store.test.ts`; cookie input: `netscape.test.ts`.
- X exported JSON/media/HTML complete end-to-end contract and live X/YouTube endpoints: none; tests use fixtures or mocks.
- Onefile save workload and budgets: [extension-onefile/PERFORMANCE.md](extension-onefile/PERFORMANCE.md); current timing gate unmeasured on this host.
