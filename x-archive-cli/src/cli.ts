import {
  downloadProfile,
  downloadSelf,
  printSummary,
  type RunOptions,
} from "./run.ts";
import { resolveBackend } from "./backend.ts";
import { downloadsRoot } from "./state.ts";

const USAGE = `x — archive X data to your machine

Usage:
  x download self                 Archive your bookmarks and likes
  x download <handle>             Archive a profile's posts, reposts and replies
  x download self --export-only   Re-export from saved data (no re-collection)
  x download self --no-render     Skip archive.html rendering
  x download <handle> --out DIR   Use DIR as the downloads root instead of the default

Options:
  --export-only   skip collection; rebuild JSON/media/render from saved data
  --collect-only  collect only; do not export
  --no-context    skip fetching strangers' ancestor posts for threads (saves time on large backfills)
  --out DIR       downloads root (default: ~/.local/share/x/downloads,
                  or X_ARCHIVE_DOWNLOADS / XDG_DATA_HOME). Bookmarks/likes
                  export to DIR/bookmarks-<date> and DIR/likes-<date>;
                  a profile exports to DIR/<handle> and is updated in place
  --no-render     skip rendering archive.html
  --backend NAME  helium (default) or bctl — see "bctl" below
  --session NAME  bctl session to launch or attach to (default: xarchive,
                  or X_ARCHIVE_SESSION)
  --cdp-url URL   attach to an existing CDP endpoint instead of launching
                  helium (http://127.0.0.1:9222) or a bctl session
                  (X_ARCHIVE_CDP_URL)
  --help, -h      show this help
  --version, -v   print the version

Exports read the X session from the browser backend over CDP:
cookies for authentication, and the query IDs/features that the X Archive
browser extension captured from your normal x.com usage. If collection
fails part-way through, re-running is safe — saved pages are retained.
Bookmarks and likes resume from the saved checkpoint. A profile scan
starts from the newest posts and stops once it catches up to what is
already archived; the archive database travels in the profile's folder.
Profile downloads also fetch the strangers' ancestor posts that archived
replies reply to — full text, author, metrics, no profile photos or
media — so threads render offline; pass --no-context to skip, and
re-running resumes a partly-finished backfill.

bctl appliance backend:
  x download self --backend bctl
  Uses the dedicated bctl session (default "xarchive") instead of everyday
  Helium: one manual sign-in (\`bctl profile login xarchive\`), then the run
  launches or reuses the appliance session and reads the X session cookies
  from the guest over CDP. The guest never reaches x.com during a run;
  GraphQL and media stay host-HTTPS. The appliance has no extension, so
  seeding from Helium's IndexedDB is unavailable and credentials come from
  the credential cache (seeded by any normal Helium run). Requires \`bctl\`
  on PATH and a working Nanos runtime (\`bctl doctor\`).
  X_ARCHIVE_BACKEND, X_ARCHIVE_SESSION and X_ARCHIVE_BCTL (binary path)
  override the defaults; X_ARCHIVE_CDP_URL attaches instead of launching.
`;

class UsageError extends Error {}

interface ParsedArgs {
  command: string;
  target: string;
  options: {
    action: RunOptions["action"];
    outRoot: string;
    render: boolean;
    noContext: boolean;
    backend: string | undefined;
    session: string | undefined;
    cdpUrl: string | undefined;
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") throw new UsageError(USAGE);
  if (command === "--version" || command === "-v") {
    process.stdout.write("x-archive-cli 0.1.0\n");
    process.exit(0);
  }
  if (command !== "download") throw new UsageError("Unknown command \"" + command + "\".\n\n" + USAGE);

  let target: string | undefined;
  let action: RunOptions["action"] = "download";
  let outRoot = downloadsRoot();
  let render = true;
  let backend: string | undefined;
  let session: string | undefined;
  let cdpUrl: string | undefined;
  let noContext = false;
  for (const arg of rest) {
    switch (true) {
      case arg === "--export-only":
        action = "export";
        break;
      case arg === "--collect-only":
        action = "collect";
        break;
      case arg === "--no-render":
        render = false;
        break;
      case arg === "--no-context":
        noContext = true;
        break;
      case arg.startsWith("--out="):
        outRoot = arg.slice("--out=".length);
        break;
      case arg === "--out":
        throw new UsageError("--out requires =DIR syntax: --out=DIR");
      case arg === "--backend":
        throw new UsageError("--backend requires =NAME syntax: --backend=helium|bctl");
      case arg.startsWith("--backend="):
        backend = arg.slice("--backend=".length);
        break;
      case arg === "--session":
        throw new UsageError("--session requires =NAME syntax: --session=NAME");
      case arg.startsWith("--session="):
        session = arg.slice("--session=".length);
        break;
      case arg.startsWith("--cdp-url="):
        cdpUrl = arg.slice("--cdp-url=".length);
        break;
      case arg === "--help" || arg === "-h":
        throw new UsageError(USAGE);
      case arg.startsWith("--"):
        throw new UsageError("Unknown flag \"" + arg + "\".\n\n" + USAGE);
      default:
        if (target !== undefined) throw new UsageError("Expected at most one target; got \"" + target + "\" and \"" + arg + "\".\n\n" + USAGE);
        target = arg;
    }
  }
  if (target === undefined) throw new UsageError("download needs a target: self, @handle, or a profile URL.\n\n" + USAGE);
  const definedTarget: string = target;
  return { command, target: definedTarget, options: { action, outRoot, render, backend, session, cdpUrl, noContext } };
}

async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    throw error;
  }
  const { target, options } = parsed;
  try {
    const resolved = resolveBackend({ backend: options.backend, session: options.session, cdpUrl: options.cdpUrl });
    const runOptions: RunOptions = {
      action: options.action,
      outRoot: options.outRoot,
      render: options.render,
      noContext: options.noContext,
      backend: resolved.backend,
      cdpUrl: resolved.cdpUrl,
    };
    if (target === "self") {
      const summaries = await downloadSelf(runOptions);
      for (const summary of summaries) printSummary("self", summary);
      return 0;
    }
    const summary = await downloadProfile(target, runOptions);
    printSummary(target, summary);
    return 0;
  } catch (error) {
    process.stderr.write("x download failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  }
}

process.on("SIGINT", () => {
  process.stderr.write("\nStopping after the current page. Re-running resumes from the saved checkpoint.\n");
  process.exit(130);
});

const code = await main(process.argv.slice(2));
process.exit(code);
