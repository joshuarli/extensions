# Upstream ground truth

Derivative of SingleFile, kept AGPL-compatible. No upstream code is vendored:
the ZIP reader, writer, wrapper selection, loader, and capture pipeline are
written from scratch against observed upstream behavior (see
[ARCHITECTURE.md](ARCHITECTURE.md)). Later slices preserve upstream license
notices and attribution wherever retained code lands.

Pinned 2026-10-27 (HEAD of `main` at pin time, verified by shallow clone):

| Upstream | SHA | Commit |
| --- | --- | --- |
| [SingleFile-MV3](https://github.com/gildas-lormeau/SingleFile-MV3) | `ad0717f20e6bf3574761a2f872b1c5cd93acb785` | 2026-10-27 bump up version |
| [single-file-core](https://github.com/gildas-lormeau/single-file-core) | `e8e08c93dfe964d7b5e746a6650cf58b20f1ee90` | 2026-10-27 bump up version |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile) | `9e000bd85d41b2ba7a07be6fca100f57f103d0d0` | 2026-10-27 link the website from the README |
| [SingleFileZ](https://github.com/gildas-lormeau/SingleFileZ) | `dc7f42ea9405705e05773a89ee7d7712055c348f` | 2024-09-24 merge rollup 3.29.5 |
| [Polyglot-HTML-ZIP-PNG](https://github.com/gildas-lormeau/Polyglot-HTML-ZIP-PNG) | `0f9049128245501c4e1db6f5ece49c44c160fd13` | 2026-07-22 fix typo |

Paths of interest at these SHAs, confirmed present by shallow clone:

- `single-file-core`: `core/index.js`, `core/helper.js`, `processors/compression/`,
  `processors/frame-tree/`, `processors/lazy/`, `zip-build/`,
  `test/sfz-harness/`
- `SingleFile-MV3`: `src/core/bg/`, `src/core/content/`
- SingleFile docs, SingleFileZ history, and the Polyglot-HTML-ZIP-PNG
  background inform the universal self-extracting ZIP shape.
