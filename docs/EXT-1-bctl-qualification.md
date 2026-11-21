# EXT-1: remaining bctl qualification

EXT-1 remains open and is the owner's feature priority. Its implementation
already selects a dedicated bctl session/profile, reads guest X cookies through
the CDP gateway, retains host-HTTPS GraphQL/media requests, skips guest
IndexedDB seeding, and refuses the everyday-browser cookie-export fallback.
The existing 30-day captured GraphQL configuration cache supplies the guest's
no-extension path. Earlier verification passed typechecking and 213 tests;
no CLI source changed during this qualification update.

## Current blocker

bctl release `release-1d41e27252484f39ea82d4275dbf74fdce70c027` adds real
headed Helium on Nanos/macOS. It passes actual dashboard rendering, input,
Unicode paste, scrolling, control revocation/reconnect, browser sandbox checks,
headed/headless/headed cookie and local-storage persistence, host downloads,
113 interoperability checks, and boot/profile-login fixtures using a downloaded
standalone runtime with its matching kernel.

Real-site follow-up is not accepted: Instagram navigation kills the browser in
both display modes. A native Linux fault stack points to an unavailable HID
backend in the pure browser build (chromium-build CHB-15); its repair is being
built as Helium r8. A separate unsigned X login-page probe stops answering CDP
and prints repeated kernel `frame already full` failures. The relation between
these failures is not established. bctl records the evidence in
`tests/qualification/results/2026-11-16-headed-macos/` and
`docs/CAMPAIGN-HEADED-NANOS.md`. The release notes disclose the Instagram issue.
Performance gates are waived; these correctness failures still block login.

Shadowdriver master `30b1c67` makes bctl the default IG backend and provides
root `make setup`. That setup downloads and verifies the release, provisions
its image trio and SDK, and supplies `.venv/bin/bctl`. Its application home is
persistent and separate from caches. This can provision the appliance without
a bctl source checkout; it does not establish real account acceptance.

## Acceptance still required

After the browser and actual X page pass, use an explicit executable and a
persistent home. For this host, Shadowdriver's downloaded shim is available:

```sh
export X_ARCHIVE_BCTL="$HOME/d/shadowdriver/.venv/bin/bctl"
"$X_ARCHIVE_BCTL" profile login xarchive --url https://x.com --wait
```

Take control in the dashboard, sign in inside guest Helium, and complete any
new-device/2FA challenge there. Enter in the login terminal stops and flushes
the owned VM. Never send credentials through chat or import everyday-browser
cookies as a substitute for this proof. The shim defaults to Shadowdriver's
persistent application home; set `BCTL_HOME` explicitly to select another
already provisioned home.

Then, from this repository:

```sh
pnpm x download self --backend=bctl
```

The exported `X_ARCHIVE_BCTL` selects the downloaded executable. Record the
completed archive result, persistent guest authentication after a restart,
media/export outcome, and whether everyday Helium was closed. Keep account
identifiers, cookies, bearer headers, CDP capabilities, and private archive
contents out of committed evidence. A fresh cache file exists on this host;
its timestamp alone does not validate its credentials or a real archive run.

An unattended run still needs observed acceptance. Record its start/end,
outcome, and any recovery or renewal failures. Do not close EXT-1 merely
because fixtures pass, a browser opens, or a short signed-in pilot completes.

## 2026-11-17 complete run on bctl release 2b858053

The owner's test X account signed in, headed, to the shared `shadowdriver-ig`
guest profile. That profile also holds the Instagram sign-in. bctl
`release-2b858053` includes the Tinyland subsurface-role fix and the kernel
page-cache read-lifetime fix that had ended earlier headed X sign-ins (see
bctl `tests/qualification/results/2026-11-17-x-signin-macos/`). After a
stop/flush and a headless restart, the profile was still signed in to both X
and Instagram.

`pnpm x download self --backend=bctl --session=shadowdriver-ig`, with
`X_ARCHIVE_BCTL` set to Shadowdriver's downloaded `bctl`, exited 0:

| Export | Posts | Media | Collection |
| --- | --- | --- | --- |
| bookmarks | 441 | 690 of 690 | `folder_query_not_captured`; main bookmarks complete |
| likes | 663 | 914 of 915 (1 unavailable) | complete |

Both exports rendered `archive.html`. The CLI reported that seeding needs the
Helium extension, which the appliance does not have, and it continued with the
local store. Bookmark folders therefore stay uncollected until the folder-list
query is captured.

Everyday Helium was running on `127.0.0.1:9222` during the run, so this run
does not establish the "Helium closed" condition. The exported account matches
the guest profile's signed-in X user, not the everyday browser's session, so
the archive came through the appliance.

Still unestablished: an unattended interval, with renewal and recovery
outcomes, and a run with everyday Helium closed.

## 2026-11-21 re-check: owner-gated, no code defect

The bctl seam is present and unchanged: `backend.ts` plans and resolves the
dedicated session, `deps.ts` refuses the everyday-browser cookie-export
fallback on the bctl path, and `run.ts` skips extension seeding on the
appliance path. `x-archive-cli/test/backend.test.ts` covers backend planning,
including the bctl session and attach overrides; the credential cache path is
covered by `x-archive-cli/test/state.test.ts`. None of this can stand in for
the 2026-11-17 run or the two unestablished conditions, and no offline
regression reproduces a CLI defect.

Local state on 2026-11-21: the 30-day cache `~/.local/state/x-archive/credentials.json`
is present from 2026-11-16; the documented Shadowdriver shim
(`~/d/shadowdriver/.venv/bin/bctl`) is absent while `~/repos/bctl` remains; no
Helium process and no listener on `127.0.0.1:9222` were found. Bookmark folders
stay incomplete until a live Helium session captures `BookmarkFoldersSlice`
and `BookmarkFolderTimeline`; `collect()` already reports
`folder_query_not_captured` instead of failing, so that is a live-capture gap,
not a code path to patch.

Closing EXT-1 therefore needs owner action and an owner decision:

1. Provision or select a working bctl executable and authorize a real
   `x download self --backend=bctl` run with everyday Helium closed. The guest
   sign-in, any new-device/2FA challenge, and the owner's X account are
   required; the agent cannot perform or substitute them.
2. Define the unattended interval and the evidence that counts as acceptance
   (start/end, outcome, renewal and recovery failures), or explicitly drop that
   requirement. A short signed-in pilot does not establish overnight
   reliability.

The ticket area is marked `Needs owner · …` until both are resolved.
