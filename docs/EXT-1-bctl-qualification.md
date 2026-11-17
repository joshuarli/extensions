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
