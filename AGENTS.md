# Repository guide

- Deno is used for its runtime APIs and to install the pinned pnpm CLI with
  `deno task bootstrap`. pnpm owns JavaScript dependencies, scripts, and the
  lockfile.
- TypeScript 7 is the authoritative checker. Vite 8 builds the MV3 extensions;
  Oxlint with `oxlint-tsgolint` handles linting.
- Use Effect 4 for extension I/O, typed failures, and Schema validation at
  network, storage, and message boundaries.
- Keep extension UI in native TypeScript, DOM, and CSS. The pages and reader
  overlay are small enough to use browser APIs directly.
- Vitest 5 runs unit tests with `pnpm run test` and browser tests with
  `pnpm run test:browser`. `pnpm run check` is the fast lint, typecheck, and
  unit-test gate. `pnpm run dist` builds production extensions.
- Do not run linters or pre-commit hooks; the user runs them independently.
  Never push changes.
