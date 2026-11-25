import { homedir } from "node:os";
import { join } from "node:path";
import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";

export { UsageError };

export const USAGE = `x discover — observe the X home feed and surface arthouse accounts

Usage:
  x discover collect [--feed=home-for-you] [--max-pages N]  Observe feed pages
  x discover derive [--check-links]                        Rebuild judgments from saved posts
  x discover report                                        Print the ranked account report
  x discover bootstrap                                     Seed candidates from bookmarks and likes
  x discover enrich --handles=a,b [--max-pages N]          Sample candidate profiles
  pnpm x:discover <command> [options]                      Same commands without the x wrapper

collect starts a new observation run at the head of the feed and commits each page
transactionally: canonical post versions, per-run appearances, the checkpoint and
the raw response. A second run for the same account is refused until the first ends.
derive and report read saved posts, so heuristics can improve without refetching.

Options:
  --feed NAME     home-for-you (default) or home-following
  --cdp-url URL   CDP endpoint (default http://127.0.0.1:9222, or X_DISCOVERY_CDP_URL)
  --backend NAME  helium or bctl
  --session NAME  bctl session name
  --max-pages N   page budget per run (default 20)
  --out DIR       output directory (default ~/.local/share/x/discovery, or X_DISCOVERY_OUT)
  --check-links   probe up to three resource links per derivation
  --help, -h      show this help
  --version, -v   print the version

Press Ctrl-C to stop after the current page; press it again to force exit. The exit
code is 130. Saved pages and checkpoints are kept; a later run starts at the head.
`;

const SCHEMA: ArgSchema = {
  values: ["feed", "cdp-url", "backend", "session", "max-pages", "out", "handles"],
  flags: ["check-links"],
  maxPositionals: 0,
};

export interface DiscoverArgs {
  cdpUrl: string;
  outDir: string;
  maxPages: number;
  feed: "home-for-you" | "home-following";
  backend: string | undefined;
  session: string | undefined;
  checkLinks: boolean;
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "collect" | "derive" | "report" | "bootstrap" | "observe" | "enrich"; args: DiscoverArgs & { handles: string[] } };

function defaultOutDir(): string {
  if (process.env["X_DISCOVERY_OUT"]) return process.env["X_DISCOVERY_OUT"];
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "x", "discovery");
}

export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { kind: "help" };
  if (command === "--version" || command === "-v") return { kind: "version" };
  if (!["collect", "derive", "report", "bootstrap", "observe", "enrich"].includes(command)) {
    throw new UsageError("Unknown x discover command \"" + command + "\".\n\n" + USAGE);
  }
  const parsed = parseCliArgs(rest, SCHEMA);
  const feed = parsed.values.get("feed") ?? "home-for-you";
  if (feed !== "home-for-you" && feed !== "home-following") {
    throw new UsageError("--feed must be home-for-you or home-following.");
  }
  const rawMaxPages = parsed.values.get("max-pages") ?? "20";
  const maxPages = Number(rawMaxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new UsageError("--max-pages must be a positive integer.");
  }
  return {
    kind: command as "collect" | "derive" | "report" | "bootstrap" | "observe" | "enrich",
    args: {
      handles: (parsed.values.get("handles") ?? "").split(",").map((handle) => handle.trim()).filter(Boolean),
      cdpUrl: parsed.values.get("cdp-url") ?? process.env["X_DISCOVERY_CDP_URL"] ?? "http://127.0.0.1:9222",
      outDir: parsed.values.get("out") ?? defaultOutDir(),
      maxPages,
      feed,
      backend: parsed.values.get("backend"),
      session: parsed.values.get("session"),
      checkLinks: parsed.flags.has("check-links"),
    },
  };
}
