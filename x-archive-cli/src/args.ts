import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";
import { DEFAULT_MAX_MEDIA_BYTES, parseMediaSize } from "../../lib/media.ts";
import { downloadsRoot } from "./state.ts";

export { UsageError };

export const USAGE = `x — archive X data to your machine

Usage:
  x lists                         Save your following and followers lists
  x download self                 Archive your bookmarks and likes
  x download <handle>             Archive a profile's posts, reposts and replies
  x download <handle> <handle>    Archive several profiles, one after another
  x download self <handle>        Combine self and profiles in one run
  x download self --export-only   Re-export from saved data (no re-collection)
  x download self --no-render     Skip archive.html rendering
  x download self --offline       Render without fetching profile assets
  x download <handle> --out DIR   Use DIR as the downloads root instead of the default

Multiple targets are processed serially in the order given. A failure stops the
run; re-running resumes each target from its saved checkpoint.
Press Ctrl-C once to stop after the current page; saved data is kept and the
next run resumes. Press it again to force exit.

Options:
  --export-only   skip collection; rebuild JSON/media/render from saved data
  --collect-only  collect only; do not export
  --no-context    skip fetching strangers' ancestor posts for threads (saves time on large backfills)
  --out DIR       downloads root (default: ~/.local/share/x/downloads,
                  or X_ARCHIVE_DOWNLOADS / XDG_DATA_HOME). Bookmarks/likes
                  export to DIR/bookmarks-<date> and DIR/likes-<date>;
                  a profile exports to DIR/<handle> and is updated in place
  --no-render     skip rendering archive.html
  --offline       render from saved files only; --export-only is always offline
  --max-media-size SIZE
                  largest media file to save (default 16MB; 0 disables the limit).
                  SIZE is bytes or a B/K/M/G suffix, e.g. 16MB or 500KB.
                  Oversized media stays in the archive data but is not written
                  to disk; if its size is unknown it is discarded once the
                  partial download passes the limit.
  --backend NAME  helium (default) or bctl — see "bctl" below
  --session NAME  bctl session to launch or attach to (default: xarchive,
                  or X_ARCHIVE_SESSION)
  --cdp-url URL   attach to an existing CDP endpoint instead of launching
                  helium (http://127.0.0.1:9222) or a bctl session
                  (X_ARCHIVE_CDP_URL)
  --help, -h      show this help
  --version, -v   print the version

Exports read the X session from the browser backend over CDP:
cookies for authentication, and the query IDs/features captured from x.com.
The CLI hot-loads the X Archive extension into the browser and opens the
pages needed for missing credentials; no manual install is required.
If collection fails part-way through, re-running is safe — saved pages are
retained.
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

export interface ParsedArgs {
  command: string;
  targets: readonly string[];
  options: {
    action: "download" | "collect" | "export";
    outRoot: string;
    render: boolean;
    noContext: boolean;
    offline: boolean;
    maxMediaBytes: number;
    backend: string | undefined;
    session: string | undefined;
    cdpUrl: string | undefined;
  };
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "download"; args: ParsedArgs }
  | { kind: "lists"; args: ParsedArgs }
  | { kind: "discover"; args: readonly string[] };

export { DEFAULT_MAX_MEDIA_BYTES };

export function parseMaxMediaSize(value: string): number {
  try {
    return parseMediaSize(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${detail}\n\n${USAGE}`);
  }
}

const schema: ArgSchema = {
  values: ["out", "backend", "session", "cdp-url", "max-media-size"],
  flags: ["export-only", "collect-only", "no-render", "no-context", "offline"],
  maxPositionals: Number.POSITIVE_INFINITY,
};

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { kind: "help" };
  if (command === "--version" || command === "-v") return { kind: "version" };
  if (command === "discover") return { kind: "discover", args: rest };
  if (command !== "download" && command !== "lists") throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  if (rest.includes("--help") || rest.includes("-h")) return { kind: "help" };
  const parsed = parseCliArgs(rest, command === "lists" ? { values: schema.values, flags: [], maxPositionals: 0 } : schema);
  if (command === "lists") {
    return { kind: "lists", args: {
      command,
      targets: [],
      options: {
        action: "download",
        outRoot: parsed.values.get("out") ?? downloadsRoot(),
        render: false,
        noContext: false,
        offline: false,
        maxMediaBytes: DEFAULT_MAX_MEDIA_BYTES,
        backend: parsed.values.get("backend"),
        session: parsed.values.get("session"),
        cdpUrl: parsed.values.get("cdp-url"),
      },
    } };
  }
  const targets = parsed.positional;
  if (targets.length === 0) throw new UsageError(`download needs at least one target: self, @handle, or a profile URL.\n\n${USAGE}`);
  if (parsed.flags.has("export-only") && parsed.flags.has("collect-only")) {
    throw new UsageError(`--export-only and --collect-only are mutually exclusive.\n\n${USAGE}`);
  }
  const action: ParsedArgs["options"]["action"] = parsed.flags.has("export-only") ? "export"
    : parsed.flags.has("collect-only") ? "collect"
    : "download";
  return { kind: "download", args: {
    command,
    targets,
    options: {
      action,
      outRoot: parsed.values.get("out") ?? downloadsRoot(),
      render: !parsed.flags.has("no-render"),
      noContext: parsed.flags.has("no-context"),
      offline: action === "export" || parsed.flags.has("offline"),
      maxMediaBytes: parsed.values.has("max-media-size")
        ? parseMaxMediaSize(parsed.values.get("max-media-size")!)
        : DEFAULT_MAX_MEDIA_BYTES,
      backend: parsed.values.get("backend"),
      session: parsed.values.get("session"),
      cdpUrl: parsed.values.get("cdp-url"),
    },
  } };
}
