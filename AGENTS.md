# Repository guide

- Deno is the runtime, package manager, task runner, and lockfile owner. Use
  `deno.json` tasks; do not add Node-first package tooling.
- TypeScript 7 is the authoritative checker. Vite 8 builds the MV3 extensions;
  Oxlint with `oxlint-tsgolint` handles linting.
- Use Effect 4 for extension I/O, typed failures, and Schema validation at
  network, storage, and message boundaries.
- Keep extension UI in native TypeScript, DOM, and CSS. The pages and reader
  overlay are small enough to use browser APIs directly.
- Vitest 5 runs unit tests with `deno task test` and browser tests with
  `deno task test:browser`. `deno task check` is the fast lint, typecheck, and
  unit-test gate. `deno task dist` builds production extensions.
- Do not run linters or pre-commit hooks; the user runs them independently.
  Never push changes.
