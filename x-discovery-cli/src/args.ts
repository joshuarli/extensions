import { homedir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";

export { UsageError };

export const USAGE = `x-discover — enumerate X accounts posting about arthouse film

Usage:
  x-discover [--cdp-url URL] [--max-pages N] [--out DIR]

Reads your signed-in home feed over CDP, saves every organic post as JSONL,
and derives arthouse scores plus download-link candidates. Re-running resumes
from the saved cursor. Raw posts are never overwritten, so classification can
be re-run as its heuristics improve.

Options:
  --cdp-url URL   CDP endpoint (default http://127.0.0.1:9222, or X_DISCOVERY_CDP_URL)
  --max-pages N   feed pages per run, positive integer (default 20)
  --out DIR       output directory (default ~/.local/share/x/discovery,
                  or X_DISCOVERY_OUT / XDG_DATA_HOME)
  --help, -h      show this help
  --version, -v   print the version

A signed-in Helium must be reachable. The X Archive extension captures the
home-timeline query ID, features and bearer token on first use; no manual
extension install is needed. Press Ctrl-C to stop after the current page.
`;

const SCHEMA: ArgSchema = {
  values: ["cdp-url", "max-pages", "out"],
  flags: ["help", "version", "h", "v"],
  maxPositionals: 0,
};

export type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; cdpUrl: string; outDir: string; maxPages: number };

function defaultOutDir(): string {
  if (process.env["X_DISCOVERY_OUT"]) return process.env["X_DISCOVERY_OUT"];
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "x", "discovery");
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed = parseCliArgs(argv, SCHEMA);
  if (parsed.flags.has("help") || parsed.flags.has("h")) return { kind: "help" };
  if (parsed.flags.has("version") || parsed.flags.has("v")) return { kind: "version" };
  const rawMaxPages = parsed.values.get("max-pages") ?? "20";
  const maxPages = Number(rawMaxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new UsageError("--max-pages must be a positive integer.");
  }
  return {
    kind: "run",
    cdpUrl: parsed.values.get("cdp-url") ?? process.env["X_DISCOVERY_CDP_URL"] ?? "http://127.0.0.1:9222",
    outDir: parsed.values.get("out") ?? defaultOutDir(),
    maxPages,
  };
}
