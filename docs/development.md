# Development

The root package owns dependencies and scripts for the unified extension. Node.js runs the build script; pnpm manages JavaScript dependencies and the lockfile. Requires Node.js 22.12 or newer.

## Setup and commands

- Run `npm install --global pnpm@11.0.2` to install the pinned pnpm CLI, then `pnpm install`.
- `pnpm run check` runs TypeScript 7.1 typechecking with `tsrs` and the unit test project.
- `pnpm run typecheck` runs `tsrs --noEmit` using the strict options in [tsconfig.json](../tsconfig.json).
- `pnpm run test` runs unit tests.
- `pnpm run test:browser` runs the Onefile Playwright browser tests.
- `pnpm run build` builds development bundles; `pnpm run dist` builds production bundles. Both typecheck first.
- `pnpm run dev` watches extension source files and rebuilds the suite.
- `pnpm run icons` rasterizes each `src/icons/icon.svg` into 16, 32, 48, and 128 pixel PNGs. Edit the SVG and rerun it after changing an icon.
- On macOS, `make install` builds production bundles and opens Helium's extensions page.

Vite writes development and production bundles to separate generated trees. Load `build/extension-suite` or `dist/extension-suite` as an unpacked extension.

## Project structure and bundle boundaries

Each `extension-*/` directory is a feature package with its own source and package-local tests. [extension-suite](../extension-suite) is the composition root: it owns the single manifest, service worker, popup, options page, icons, and the per-tab action status. Feature packages expose background handlers and `manifest.fragment.ts` files; they do not register global Chrome listeners themselves.

[vite.config.ts](../vite.config.ts) defines the suite entry points; [the build script](../scripts/build-extensions.mjs) bundles them, copies static assets, and writes the composed manifest. One output folder contains one ES service worker, the ES popup and options bundles, feature pages, and classic injected scripts under `inject/<feature>/`.

The service worker is emitted as an ES module. Scripts injected with `chrome.scripting.executeScript()` are emitted as classic scripts, so keep their formats separate. The UI uses browser DOM APIs directly; Effect and Schema handle extension I/O and boundary validation.

The shared package pins `tsrs` 0.18.0, TypeScript 7.1, Vite 8, Effect 4, and Vitest 5. `tsrs` uses the strict options in [tsconfig.json](../tsconfig.json). Its native macOS build supports Apple silicon only, so typechecking is unavailable on Intel Macs.
