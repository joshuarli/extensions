# Repository guide

This repository builds one Chromium Manifest V3 extension from five feature packages with shared TypeScript and Vite tooling.

The roadmap, [docs/roadmap.md](docs/roadmap.md), holds all current and future work; its Status is the resume point.

## Commands

`make clean` removes this checkout’s build output in `./build` and `./dist`. It refuses symlinks and ordinary files at those paths.

- Install the pinned pnpm CLI with Node.js: `npm install --global pnpm@11.0.2`
- Install dependencies: `pnpm install`
- Check types and unit tests: `pnpm run check`
- Build development or production bundles: `pnpm run build` or `pnpm run dist`; `pnpm run dist` also regenerates the embedded runtime assets in `lib/generated/assets.ts`
- Run a CLI: `pnpm tools <x|onefile|youtube|chatgpt> [args...]`
- Run browser tests: `pnpm run test:browser`

## Invariants

- **Every extension in this repository MUST be included in `extension-suite`.** `extension-suite` is the only installable extension; separately installable `extension-*` packages and standalone extension builds are not allowed. Each `extension-*` package must contribute a `manifest.fragment.ts` composed by `extension-suite/src/manifest.ts`, expose background behavior to the suite service worker instead of registering global Chrome listeners, and surface its UI through the suite popup or options page. A new package is not done until it is in the suite.
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
- Shared CLI shell for terminal CLIs: [lib/cli.ts](lib/cli.ts), [lib/progress.ts](lib/progress.ts)
- Allow Right-Click architecture: [docs/allow-right-click.md](docs/allow-right-click.md)
- YouTube user and message API: [extension-youtube-transcript/README.md](extension-youtube-transcript/README.md)
- YouTube transcript domain and CLI: [youtube-transcript-core](youtube-transcript-core/README.md), [youtube-transcript-cli](youtube-transcript-cli/README.md)
- X Archive credential capture for the CLI: [extension-x-archive/README.md](extension-x-archive/README.md)
- Onefile terminal CLI: [onefile-cli/README.md](onefile-cli/README.md)
- Onefile domain core: [onefile-core/README.md](onefile-core/README.md)
- Onefile save and format: [extension-onefile/README.md](extension-onefile/README.md), [extension-onefile/ARCHITECTURE.md](extension-onefile/ARCHITECTURE.md), [extension-onefile/FORMAT.md](extension-onefile/FORMAT.md)
- ChatGPT organizer (suite feature): [extension-chatgpt/README.md](extension-chatgpt/README.md)
- ChatGPT archive domain logic: [chatgpt-archive-core/README.md](chatgpt-archive-core/README.md)
- ChatGPT archive CLI: [chatgpt-archive-cli/README.md](chatgpt-archive-cli/README.md)
- X home-feed discovery SDK: [x-discovery-core](x-discovery-core/src/index.ts), [x-discovery-cli/README.md](x-discovery-cli/README.md)
- X following and followers lists: [x-archive-cli/README.md](x-archive-cli/README.md)

## Verification

- `make test` typechecks and runs all Node Vitest tests; `make lint` independently typechecks and runs type-aware Oxlint `no-unsafe-argument` over TypeScript.
- `make test TEST_ARGS=--maxWorkers=1` bounds Vitest workers; browser tests are separate (`pnpm run test:browser`).
- `make coverage TEST_ARGS=--maxWorkers=1` reports first-party Node line and branch coverage in `.work/coverage/`. It includes unimported source and has no threshold.
- Suite composition (every extension package contributes a fragment), manifest and bundle shape: `extension-allow-right-click/test/extension-contract.test.ts`; suite messages: `extension-suite/test/message-contract.test.ts`.
- Right-click page behavior: `extension-allow-right-click/test/user-select-restoration.browser.test.ts`. The installed Chromium CI job tests the real service worker and the right-click toggle in `extension-onefile/test/browser/extension-runtime.spec.ts`.
- YouTube messages: `extension-youtube-transcript/test/message-contract.test.ts`; HTTP and transcript parsing: `http.test.ts`, `transcript.test.ts` in that test directory.
- Onefile capture messages: `extension-onefile/test/message-contract.test.ts`; ZIP and HTML formats: `zip.test.ts`, `polyglot.test.ts`, `archive-integrity.test.ts`; Chromium capture: `test/browser/capture.spec.ts`.
- X GraphQL request and response handling: `x-archive-core/test/api.test.ts`, `parser.test.ts`, `merge.test.ts`, `collector.test.ts`, `debug.test.ts`; extension credential capture: `extension-x-archive/test/capture.test.ts`.
- X CLI flags and exit codes: `x-archive-cli/test/args.test.ts`; backend selection: `x-archive-cli/test/backend.test.ts`; filesystem state: `fs-store.test.ts`; CDP extension hot-load and credential capture: `extension.test.ts`, `credential-capture.test.ts`; archive rendering: `x-archive-core/test/render.test.ts`.
- X exported JSON/media/HTML complete end-to-end contract and live X/YouTube endpoints: none; tests use fixtures or mocks.
- ChatGPT archive: paging, early-stop paging, checkpoint state, timeframe, media pointers and record hashing in `chatgpt-archive-core/test/`; CLI flags, selection, append-only resume, cross-day checkpointing, legacy import, cooperative interrupt and media size cap in `chatgpt-archive-cli/test/` (`parity.test.ts` for the last four). Interrupt controller and media size helpers are covered in `lib/test/`. `chatgpt-archive-cli/test/cdp-live.test.ts` drives the CLI through a real CDP endpoint against routed fixtures.
- Performance workloads, entrypoint and budgets: [extension-onefile/PERFORMANCE.md](extension-onefile/PERFORMANCE.md); `make bench-list`, `make bench BENCH_ARGS='--tier=edit'`, Change workloads and `--budget=BASE,CAND`; Full is manual only.
- ChatGPT organizer: `extension-chatgpt/test/{api,queue,storage,messages,model,security,safety}.test.ts`; installed-suite Chromium tests driving the real dashboard at `features/chatgpt/dashboard.html`: `extension-chatgpt/test/browser/extension-runtime.spec.ts` (`pnpm run test:browser:chatgpt`, run in CI). Invariants, regressions and release blockers: [extension-chatgpt/QUALIFICATION.md](extension-chatgpt/QUALIFICATION.md).
