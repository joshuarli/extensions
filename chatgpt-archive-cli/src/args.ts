import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";
import { DEFAULT_MAX_MEDIA_BYTES, parseMediaSize } from "../../lib/media.ts";
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
  --max-media-size SIZE  largest media file to save (default 16MB; 0 disables).
                         SIZE is bytes or B/KB/MB/GB, e.g. 16MB or 500KB.
                         Oversized media stays in the records but is not written.
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
  Each account archives to DIR/chatgpt-<account-id>/: records.jsonl,
  media/, state.json and manifest.json. The records file is append-only: a
  rerun skips saved ids, appends missing ones and appends a new line for any
  chat updated since it was saved. state.json checkpoints the conversation
  lists, so a completed archive stops listing at the first page already
  covered by saved records. Use --limit for a timeboxed run and rerun to
  continue on any later day. manifest.json is rewritten at the end of every
  run from what was saved, including a stopped run.

  Press Ctrl-C once to stop after the current record or media file; saved
  data is kept and re-running resumes. Press it again to force exit. The
  interrupted run exits 130.

Media:
  Referenced images, files and other media are downloaded into the account's
  media/ folder and counted in manifest.json. Files already on disk are
  skipped; oversized files stay referenced in records.jsonl and are listed
  under media.oversized so a later run with a larger limit can fetch them.
  Downloads are best-effort: a missing library file, an expired link or a
  non-2xx body is reported as a failure without failing the archive. Use
  --no-media to skip media entirely. No cookies, tokens or headers are
  written to disk.
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
  readonly maxMediaBytes: number;
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
  values: ["since", "until", "time-field", "out", "max-media-size", "limit", "backend", "session", "cdp-url"],
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

function parseMaxMediaSize(value: string): number {
  try {
    return parseMediaSize(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${detail}\n\n${USAGE}`);
  }
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
      maxMediaBytes: parsed.values.has("max-media-size")
        ? parseMaxMediaSize(parsed.values.get("max-media-size")!)
        : DEFAULT_MAX_MEDIA_BYTES,
      limit: limitValue === undefined ? null : parseLimit(limitValue),
      backend: parsed.values.get("backend"),
      session: parsed.values.get("session"),
      cdpUrl: parsed.values.get("cdp-url"),
    },
  };
}
