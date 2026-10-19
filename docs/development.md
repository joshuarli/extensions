# Development

The root package owns dependencies and scripts for both extensions. Deno installs the pinned pnpm CLI; pnpm manages JavaScript dependencies and the lockfile.

## Setup and commands

- Run `deno task bootstrap` to install pnpm 11.0.2, then `pnpm install`.
- `pnpm run check` runs TypeScript 7 typechecking and the unit test project.
- `pnpm run typecheck` runs `tsc --noEmit` using the strict options in `tsconfig.json`.
- `pnpm run test` runs unit tests.
- `pnpm run build` builds development bundles; `pnpm run dist` builds production bundles. Both typecheck first.
- `pnpm run dev` watches extension source files and rebuilds changed extensions.
- On macOS, `make install` builds production bundles and opens Helium's extensions page.

Vite writes development and production bundles to separate generated trees. Load a production extension folder as an unpacked extension; the root README lists their names.

## Project structure and bundle boundaries

Each `extension-*/` directory contains a manifest, source files, and package-local tests. [vite.config.ts](../vite.config.ts) defines the extension entry points; [the build script](../scripts/build-extensions.mjs) bundles them and copies static assets.

Service workers are emitted as ES modules. Scripts injected with `chrome.scripting.executeScript()` are emitted as classic scripts, so keep their formats separate. The UI uses browser DOM APIs directly; Effect and Schema handle extension I/O and boundary validation.

The shared package pins TypeScript 7, Vite 8, Effect 4, and Vitest 5. TypeScript uses the strict options in [tsconfig.json](../tsconfig.json).
