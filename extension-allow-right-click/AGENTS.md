# Allow Right-Click — Extension Architecture

Chromium-only Manifest V3 extension. Clicking the toolbar icon toggles the
right-click and selection unblocker for the active tab; the gray icon means
inactive and the blue icon means active. There are no menus, options, host
whitelists, notifications, automatic activation paths, or alternate browser
implementations.

## File map

```text
src/
├── manifest.json
├── service-worker.ts                 # Toolbar click, icon state, script injection
├── global.d.ts                       # Shared injected-page and message types
└── data/
    ├── icons/                        # Gray default and blue active icons
    └── inject/
        ├── core.ts                   # Per-frame activation/deactivation toggle
        ├── mouse.ts                  # Right-click and long-press element targeting
        ├── styles.ts                 # Selection and pointer-event styles
        ├── listen/
        │   ├── isolated.ts           # Stops page listeners from blocked events
        │   └── main.ts               # Restores page-global event behavior
        └── user-select/
            ├── isolated.ts           # Removes user-select restrictions
            └── main.ts               # Preserves programmatic selection
```

## Runtime contract

`service-worker.ts` injects `data/inject/core.js` into every frame of the active tab.
`core.ts` owns the per-frame `window.pointers.status` state:

- `""` or `"removed"` → set `"ready"`, ask the worker to activate, and load
  the protected and MAIN-world scripts.
- `"ready"` → set `"removed"`, run each registered cleanup, dispatch
  `arc-remove` for MAIN-world cleanup, and restore cached inline styles.

The worker updates the toolbar icon only for frame zero. The protected scripts
run in the isolated extension world; `user-select/main.ts` and `listen/main.ts`
run in the page's MAIN world because they override page JavaScript prototypes.

Each injected script is bundled separately as a classic script. The service
worker is bundled as an ES module. Keep those output formats distinct.

## Build and validation

```text
cd ..
deno task dist
deno task typecheck
deno task fmt:check
deno task lint:check
```

`build/` and `dist/` are generated extension directories. Load `dist/` as an
unpacked Chromium extension for manual browser testing.
