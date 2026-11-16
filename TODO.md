Prefix: EXT
Next: 2
### EXT-1 · P3 · Run the X archive CLI inside a bctl appliance instead of everyday Helium

- **Area:** x-archive-cli
- **Where:** x-archive-cli/src/deps.ts, x-archive-cli/src/run.ts, ~/repos/bctl (profile login, cdp-url, exec jobs)
- **Problem:** The CLI needs everyday Helium on 127.0.0.1:9222 for X session cookies and the extension's captured GraphQL credentials on every run. Unattended or background archiving (idle machine, overnight) requires keeping the daily browser open with the remote debugging port; it does not scale to a scheduled appliance.
- **Recommendation:** Add a backend seam to the CLI: bctl backend launches or attaches to a bctl session (bctl profile login xarchive once, then bctl up) and uses context.cookies() from the guest session for X auth, with credentials served by the existing 60-day cache in x-archive-cli/src/deps.ts (seeded by any normal `x download self` run) since the guest has no extension and no host directory. Media stays host-HTTPS. Prerequisite: bctl runtime built and qualified on this machine (bctl doctor currently fails: runtime/nanos/kernel.img missing; SmolVM is built only from source).
- **Fix with:** none
- **Effort:** M

