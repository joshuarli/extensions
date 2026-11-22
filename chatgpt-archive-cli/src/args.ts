import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";
import type { TimeField } from "../../chatgpt-archive-core/src/index.ts";
import { downloadsRoot } from "./state.ts";

export { UsageError };

export const USAGE = `chatgpt-archive — download ChatGPT conversations to your machine

Usage:
  chatgpt-archive download [options]

Options:
  --since ISO            only archive chats at or after this ISO-8601 timestamp
  --until ISO            only archive chats at or before this ISO-8601 timestamp
  --time-field FIELD     created or updated (default: updated)
  --out DIR              downloads root (default: ~/.local/share/chatgpt-archive/downloads,
                         or CHATGPT_ARCHIVE_DOWNLOADS / XDG_DATA_HOME)
  --include-archived     include the Archived section as well as active chats
  --no-media             do not download media referenced by conversations
  --limit N              write at most N new records in this run
  --backend NAME         helium (default) or bctl
  --session NAME         bctl session to launch or attach to (default: chatgpt-archive,
                         or CHATGPT_ARCHIVE_SESSION)
  --cdp-url URL          attach to an existing CDP endpoint instead of launching
                         Helium (http://127.0.0.1:9222) or a bctl session
  --help, -h             show this help
  --version, -v          print the version

Browser and sign-in:
  The default backend attaches to Helium's debugging port on 127.0.0.1:9222.
  Start Helium with remote debugging enabled and sign in to chatgpt.com once
  in that browser. The run reuses an open https://chatgpt.com/* tab, or opens
  one if needed. Use --cdp-url to attach to another endpoint, or
  --backend bctl to use a dedicated session. ChatGPT traffic goes through
  that page; no cookies or access tokens are written to disk.

Timeframe:
  --since and --until are inclusive ISO-8601 timestamps compared against the
  field selected by --time-field (default: updated). A chat created before
  --since is still archived when its update time falls inside the range.
  The filter is applied to conversation metadata before full conversations
  are fetched.

Resume:
  Each calendar day writes to DIR/chatgpt-YYYY-MM-DD/. records.jsonl is
  append-only: a rerun on the same day decodes the saved lines, skips ids
  already present, and appends only missing records. Use --limit for a
  timeboxed run and rerun to continue. After an interrupt, saved records
  are kept and the next run resumes from them. manifest.json is rewritten
  at the end of each run and describes every record in that day's file.

Media:
  Referenced images, files and other media are downloaded alongside records
  into DIR/chatgpt-YYYY-MM-DD/media/ and counted in manifest.json. Downloads
  are best-effort: a missing library file, an expired link or a non-2xx body
  is reported as a failure without failing the archive. Use --no-media to
  skip media entirely. No cookies, tokens or headers are written to disk.
`;

export interface DownloadOptions {
  readonly since: string | null;
  readonly until: string | null;
  readonly sinceMs: number | null;
  readonly untilMs: number | null;
  readonly timeField: TimeField;
  readonly outRoot: string;
  readonly includeArchived: boolean;
  readonly noMedia: boolean;
  readonly limit: number | null;
  readonly backend: string | undefined;
  readonly session: string | undefined;
  readonly cdpUrl: string | undefined;
}

export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "download"; readonly options: DownloadOptions };

const schema: ArgSchema = {
  values: ["since", "until", "time-field", "out", "limit", "backend", "session", "cdp-url"],
  flags: ["include-archived", "no-media"],
  maxPositionals: 0,
};

function parseTimestamp(value: string, name: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new UsageError(`--${name} must be an ISO-8601 timestamp, got "${value}".\n\n${USAGE}`);
  }
  return ms;
}

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new UsageError(`--limit must be a positive integer, got "${value}".\n\n${USAGE}`);
  }
  return limit;
}

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { kind: "help" };
  if (command === "--version" || command === "-v") return { kind: "version" };
  if (command !== "download") throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  if (rest.includes("--help") || rest.includes("-h")) return { kind: "help" };
  const parsed = parseCliArgs(rest, schema);
  const timeFieldValue = parsed.values.get("time-field") ?? "updated";
  if (timeFieldValue !== "created" && timeFieldValue !== "updated") {
    throw new UsageError(`--time-field must be "created" or "updated", got "${timeFieldValue}".\n\n${USAGE}`);
  }
  const since = parsed.values.get("since") ?? null;
  const until = parsed.values.get("until") ?? null;
  const limitValue = parsed.values.get("limit");
  return {
    kind: "download",
    options: {
      since,
      until,
      sinceMs: since === null ? null : parseTimestamp(since, "since"),
      untilMs: until === null ? null : parseTimestamp(until, "until"),
      timeField: timeFieldValue,
      outRoot: parsed.values.get("out") ?? downloadsRoot(),
      includeArchived: parsed.flags.has("include-archived"),
      noMedia: parsed.flags.has("no-media"),
      limit: limitValue === undefined ? null : parseLimit(limitValue),
      backend: parsed.values.get("backend"),
      session: parsed.values.get("session"),
      cdpUrl: parsed.values.get("cdp-url"),
    },
  };
}
