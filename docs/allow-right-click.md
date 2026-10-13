# Allow Right-Click

The toolbar icon toggles the extension for the active tab. When enabled, it restores right-click, text selection, copy, paste, and drag behavior blocked by a page.

## Injection and state

The service worker injects the bundle built from [core.ts](../extension-allow-right-click/src/data/inject/core.ts) into every frame. Each frame tracks its own activation state. On activation, the worker loads protected scripts in the isolated extension world and loads the two prototype overrides in the page's MAIN world. The scripts handle user-select restrictions, pointer styles and targeting, and page event listeners.

On deactivation, each frame runs registered cleanup callbacks, dispatches `arc-remove` for MAIN-world cleanup, and restores cached inline styles. The worker changes the toolbar icon for the top frame only.

The service worker is an ES module; each injected script is a classic bundle. There are no options, per-site settings, menus, or automatic activation paths.

See [shared build and test commands](development.md).
