# Development

The root package owns dependencies and scripts for all three extensions. Deno installs the pinned pnpm CLI; pnpm manages JavaScript dependencies and the lockfile.

## Setup and commands

- Run `deno task bootstrap` to install pnpm 11.0.2, then `pnpm install`.
- `pnpm run check` runs TypeScript 7 typechecking and the unit test project.
- `pnpm run typecheck` runs `tsc --noEmit` using the strict options in `tsconfig.json`.
- `pnpm run test` runs unit tests; `pnpm run test:browser` builds browser-test bundles and runs Chromium tests with Vitest Browser Mode and Playwright.
- `pnpm run build` builds development bundles; `pnpm run dist` builds production bundles. Both build Loupe's WASM adapter and typecheck first.
- `pnpm run dev` builds the WASM adapter, then watches extension source files and rebuilds changed extensions.
- `pnpm run reader-sample` regenerates Loupe's tracked sample fixture from its source HTML.
- On macOS, `make install` builds production bundles and opens Helium's extensions page.

Vite writes development and production bundles to separate generated trees. Load a production extension folder as an unpacked extension; the root README lists their names.

## Project structure and bundle boundaries

Each `extension-*/` directory contains a manifest, source files, and package-local tests. [vite.config.ts](../vite.config.ts) defines the extension entry points; [the build script](../scripts/build-extensions.mjs) bundles them and copies static assets.

Service workers are emitted as ES modules. Scripts injected with `chrome.scripting.executeScript()` are emitted as classic scripts, so keep their formats separate. The UI uses browser DOM APIs directly; Effect and Schema handle extension I/O and boundary validation.

The shared package pins TypeScript 7, Vite 8, Effect 4, and Vitest 5. TypeScript uses the strict options in [tsconfig.json](../tsconfig.json). The browser test runner uses `CHROMIUM_BINARY_PATH` when set, otherwise it uses the standard macOS Chromium path if present or Playwright's managed browser.

## Loupe WASM build

The default Rust checkout is `../defuddle-rs`. Set `DEFUDDLE_RS_DIR` to use a different location.

The `defuddle` crate declares `rustybench` as a local development dependency, so Cargo requires that checkout for the WASM build. For the default checkout, clone revision `56a0611` beside `defuddle-rs`:

```sh
git clone https://github.com/joshuarli/rustybench.git ../rustybench
git -C ../rustybench checkout 56a0611
```

If `DEFUDDLE_RS_DIR` points elsewhere, place the `rustybench` checkout beside that directory.

The build adds the `wasm32-unknown-unknown` target with rustup when needed. It requires a `wasm-bindgen` CLI that matches the sibling checkout's lockfile and Binaryen's `wasm-opt`. If needed, the build installs the matching CLI with Cargo and installs Binaryen with Homebrew on macOS. It runs `wasm-opt -Oz --strip-debug`. Set `WASM_BINDGEN` or `WASM_OPT` to select executable paths.

To validate the Rust checkout, run `cargo test --workspace` and `cargo check --workspace --target wasm32-unknown-unknown` from that checkout.
