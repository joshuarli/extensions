# instagram-archive-core

Pure domain logic for the Instagram archive. It has no browser, CLI, or
filesystem dependency.

- `parser.ts` normalizes timeline nodes into `Post` values. A node with a
  shortcode but no usable media fails loudly instead of being dropped.
  Carousel order and media kinds are preserved.
- `media.ts` derives stable media filenames from shortcodes and checks
  completion from file existence.
- `state.ts` encodes and decodes the per-collection checkpoint with Effect
  Schema. Unreadable state returns `null`.
- `render.ts` builds the static collection pages, data JSON, and index. It
  escapes user text before writing HTML.

The wire shape from `instagram-client-core` and the persisted records are
separate types. Nothing here fetches or writes a file.

## Tests

```
pnpm exec vitest run instagram-archive-core --maxWorkers=1
```
