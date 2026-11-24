# Onefile core

Domain logic shared by the Onefile suite feature and `onefile-cli`: the capture
payload schema, capture policy, resource fetching, module-graph walking, stored
ZIP/polyglot assembly, filenames, and the Effect save workflow.

The browser extension keeps only browser-bound code: the suite background
adapter, offscreen download document, injected viewer script, icons, and manifest
fragment. `onefile-cli` injects `src/inject/capture.ts` from this package over CDP
and calls the same `saveTab` workflow, so both producers write the same archive
format.

The format contract stays in [extension-onefile/FORMAT.md](../extension-onefile/FORMAT.md).
