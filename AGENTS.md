# Repository guide

This repository builds four Chromium Manifest V3 extensions with shared TypeScript and Vite tooling.

## Commands

- Install the pinned pnpm CLI with Node.js: `npm install --global pnpm@11.0.2`
- Install dependencies: `pnpm install`
- Check types and unit tests: `pnpm run check`
- Build development or production bundles: `pnpm run build` or `pnpm run dist`
- Run browser tests: `pnpm run test:browser`

## Invariants

- Service workers are ES modules; scripts injected into pages are classic bundles.
- Keep extension UI in native TypeScript, DOM, and CSS.
- Use Effect 4 for extension I/O and typed failures; use Schema at network, storage, and message boundaries.
- Never push changes or run pre-commit hooks.

## Topics

- Shared setup, builds, and tests: [docs/development.md](docs/development.md)
- Allow Right-Click architecture: [docs/allow-right-click.md](docs/allow-right-click.md)
- YouTube user and message API: [extension-youtube-transcript/README.md](extension-youtube-transcript/README.md)
- X Bookmarks collection/export: [extension-x-bookmarks/README.md](extension-x-bookmarks/README.md)
- Onefile save and format: [extension-onefile/README.md](extension-onefile/README.md), [extension-onefile/ARCHITECTURE.md](extension-onefile/ARCHITECTURE.md), [extension-onefile/FORMAT.md](extension-onefile/FORMAT.md)
