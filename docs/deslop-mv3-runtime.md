# Installed MV3 boundary: DSLP-4 slice

At base `fc01edf3f221912aeb7fcf964028d24cc8568bbc`, the 12 ordinary
Onefile browser tests load capture code into ordinary pages; they do not load
an extension. The new test launches the built suite in a fresh persistent
Chromium profile under `.work/tmp`, serves only a loopback fixture, triggers
the suite action on that tab with CDP, and sends actual runtime messages from
an extension page. It asserts initial empty status, successful toggle, `on`,
second successful toggle, and `off`. The action supplies the `activeTab` grant
needed for the suite's real scripting path. The passing run observed worker
`chrome-extension://njmnfifngefkdcmokldagignedgfebjk/service-worker.js` and
fixture tab target `B558C5F7B13C840EBAB848AE013EF1B4`; the test obtains both
from its own context, rather than assuming either identifier.

The test covers message routing and the injected core's state as observed by
the worker. It does not establish right-click restoration for every page,
worker restart or extension update behavior, Onefile capture/download,
external messages, X or YouTube integration, or real user profiles. Browser
flakiness is not measured by a single passing run.

## Contract review

`extension-allow-right-click/test/extension-contract.test.ts` checks the MV3
manifest composition and ES worker/classic injected bundle shapes;
`extension-suite/test/message-contract.test.ts` checks namespaced message and
response schemas. Both passed in the full Node run. The suite's routing and
listener registrations are at `extension-suite/src/service-worker.ts:66` and
`:109`. A search for `chrome.*.addListener` in feature sources and `lib`
found suite runtime, tab, webRequest and context-menu registrations at
`:109-172`; `extension-x-bookmarks/src/background.ts:78` registers the
storage badge listener when the suite calls its installer, and
`extension-x-bookmarks/src/profile-export.ts:142` registers a temporary
download listener removed upon completion or timeout. This is a bounded
static inventory, not proof of all indirect listener registrations or worker
lifecycle behavior. No runtime or manifest source changed.

## Reproduction and controls

Node 26.12.0, pnpm 11.0.2, Playwright 1.64.1 and cached Chromium, on the
assigned worktree. Set `TMPDIR="$PWD/.work/tmp"`, `PYTHON_CPU_COUNT=2`,
`CARGO_BUILD_JOBS=1`, `RUST_TEST_THREADS=1`, and `RUSTC_WRAPPER=kache`.
Before **each** heavy command acquire one of
`/Users/josh/d/stuff/.work/tmp/deslop-heavy-slots/{1,2,3}` with atomic `mkdir`,
fail closed if none is available, and release only that slot in a trap. Run
under `cpu-guard --cores 2 --`:

- `pnpm install --frozen-lockfile --ignore-scripts`: exit 0.
- `pnpm run build`: exit 0, both before and after the fault.
- `make test TEST_ARGS=--maxWorkers=1`: exit 0, 33 files, 253 tests.
- `make lint`: exit 0.
- `pnpm run test:browser --workers=1 extension-onefile/test/browser/capture.spec.ts extension-onefile/test/browser/hardening.spec.ts extension-onefile/test/browser/polyglot-render.spec.ts`: exit 0, 12 tests.
- `pnpm run test:browser --workers=1`: exit 0, 13 tests including the installed suite.

For the independent fault, acquire the atomic
`/Users/josh/d/stuff/.work/tmp/mutation.lock` **first**, then a heavy slot;
back up `build/extension-suite/service-worker.js` and restore it in the exit
trap before releasing the two owned locks. Replace exactly one occurrence of
`status === "ready" ? "on" : status === "removed" ? "off" : ""` with
`status === "ready" ? "off" : status === "removed" ? "off" : ""` in that
built file. Run `cpu-guard --cores 2 -- pnpm run test:browser --workers=1
extension-onefile/test/browser/extension-runtime.spec.ts`. It exited 1 at the
`on` assertion, receiving `off`; the original file was restored and an
ordinary build and all checks above passed after the fault. This is one
hand-injected fault, not a complete mutation inventory or CI qualification.

Post-rebuild SHA-256: `service-worker.js`
`69dc6b230207197b8f5a9301521db30b415d9eebaae096a8f3c1778a8396a951`;
`inject/allow-right-click/core.js`
`65ad998a8d0e4b3c7d14a57d7b0571a9a95ba2432e22bdea80e08e6283ba1804`;
`manifest.json`
`897a5d678c3cfe63d5941f8210739a335e244960cf9b3090b05250e64274056c`.

The consecutive old/new browser correctness runs had elapsed times 2.68/3.32s,
but `perf-gate-ready` reported a hot unrelated process before the first run.
They are not gate-ready measurements. Whole-step cost remains deferred and the
broader Tests and lifecycle work remain open.
