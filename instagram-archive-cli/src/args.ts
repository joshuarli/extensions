import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";
import { join } from "node:path";
import { homedir } from "node:os";

export { UsageError };

export const DEFAULT_PAUSE_MS = 1500;

export const COMMANDS = ["scan", "get", "update", "build", "info", "following", "follow", "get-post"] as const;
export type CommandName = (typeof COMMANDS)[number];

export const USAGE = `instagram-archive — archive Instagram posts and reels to your machine

Usage:
  instagram-archive <command> [options] [@username ...]

Commands:
  scan        record profile or saved membership
  get         download media for recorded posts
  update      rescan known collections, then download missing media
  build       render the static archive site
  info        summarize the archive
  following   print the logged-in account's following list
  follow      follow one or more accounts (the only state-changing command)
  get-post    archive one shortcode or post URL

Options:
  --saved              target the logged-in account's saved collection
  --out DIR            archive root (default: ~/.local/share/instagram-archive)
  --media-dir DIR      media directory inside the archive (default: images)
  --pause-ms N         wait N ms between posts and pages (default: 1500)
  --limit N            stop after N posts in this run
  --resume             deliberately resume a parked job
  --refresh            fetch a fresh following list
  --dry-run            preview remove/follow without changing state
  --backend NAME       helium (default) or bctl
  --session NAME       bctl session name
  --cdp-url URL        attach to an existing CDP endpoint
  --help, -h           show this help
  --version, -v        print the version

Browser and sign-in:
  The default backend attaches to Helium on 127.0.0.1:9222. Sign in to Instagram
  once in that browser. Cookies and tokens are never written to disk.

Parking:
  A rate limit, login redirect, checkpoint, account warning or unrecognized
  response parks the whole job with its reason in job.json. Later runs refuse
  to continue until --resume is passed deliberately.
`;

export interface CommandOptions {
  readonly command: CommandName;
  readonly saved: boolean;
  readonly outRoot: string;
  readonly mediaDir: string;
  readonly pauseMs: number;
  readonly limit: number | null;
  readonly resume: boolean;
  readonly refresh: boolean;
  readonly dryRun: boolean;
  readonly backend: string | undefined;
  readonly session: string | undefined;
  readonly cdpUrl: string | undefined;
  readonly targets: readonly string[];
}

export type ParsedCommand =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "run"; readonly options: CommandOptions };

const schema: ArgSchema = {
  values: ["out", "media-dir", "pause-ms", "limit", "backend", "session", "cdp-url"],
  flags: ["saved", "resume", "refresh", "dry-run"],
  maxPositionals: 64,
};

function nonNegative(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`--${name} must be a non-negative integer, got "${value}".\n\n${USAGE}`);
  }
  return parsed;
}

function positive(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UsageError(`--${name} must be a positive integer, got "${value}".\n\n${USAGE}`);
  }
  return parsed;
}

export function downloadsRoot(): string {
  const configured = process.env["INSTAGRAM_ARCHIVE_DOWNLOADS"];
  if (configured !== undefined && configured !== "") return configured;
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "instagram-archive");
}

export function parseArgs(argv: readonly string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") return { kind: "help" };
  if (command === "--version" || command === "-v") return { kind: "version" };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  }
  if (rest.includes("--help") || rest.includes("-h")) return { kind: "help" };
  const parsed = parseCliArgs(rest, schema);
  const limit = parsed.values.get("limit");
  return {
    kind: "run",
    options: {
      command: command as CommandName,
      saved: parsed.flags.has("saved"),
      outRoot: parsed.values.get("out") ?? downloadsRoot(),
      mediaDir: parsed.values.get("media-dir") ?? "images",
      pauseMs: nonNegative(parsed.values.get("pause-ms"), "pause-ms", DEFAULT_PAUSE_MS),
      limit: limit === undefined ? null : positive(limit, "limit", 1),
      resume: parsed.flags.has("resume"),
      refresh: parsed.flags.has("refresh"),
      dryRun: parsed.flags.has("dry-run"),
      backend: parsed.values.get("backend"),
      session: parsed.values.get("session"),
      cdpUrl: parsed.values.get("cdp-url"),
      targets: parsed.positional,
    },
  };
}
