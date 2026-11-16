import { join } from "node:path";
import { homedir } from "node:os";
import {
  downloadProfile,
  downloadSelf,
  printSummary,
  type RunOptions,
} from "./run.ts";
import { defaultCdpUrl } from "./deps.ts";

const USAGE = `x — archive X data to your machine

Usage:
  x download self                 Archive your bookmarks and likes
  x download <handle>             Archive a profile's posts, reposts and replies
  x download self --export-only   Re-export from saved data (no re-collection)
  x download self --no-render     Skip archive.html rendering
  x download <handle> --out DIR   Write the archive folder into DIR

Options:
  --export-only   skip collection; rebuild JSON/media/render from saved data
  --collect-only  collect only; do not export
  --out DIR       output directory (default: ~/Downloads)
  --no-render     skip rendering archive.html
  --cdp-url URL   Helium CDP endpoint (default: http://127.0.0.1:9222,
                  or X_ARCHIVE_CDP_URL, or X_ARCHIVE_CDP_URL env var)
  --help, -h      show this help
  --version, -v   print the version

Exports read the X session from the Helium browser on the CDP endpoint:
cookies for authentication, and the query IDs/features that the X Archive
browser extension captured from your normal x.com usage. If collection
fails part-way through, re-running is safe — saved pages are retained and
collection resumes from the last checkpoint.
`;

class UsageError extends Error {}

interface ParsedArgs {
  command: string;
  target: string;
  options: RunOptions & { outRoot: string };
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
  let outRoot = join(homedir(), "Downloads");
  let render = true;
  let cdpUrl = defaultCdpUrl();
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
      case arg.startsWith("--out="):
        outRoot = arg.slice("--out=".length);
        break;
      case arg === "--out":
        throw new UsageError("--out requires =DIR syntax: --out=DIR");
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
  return { command, target: definedTarget, options: { action, outRoot, render, cdpUrl } };
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
    if (target === "self") {
      const summaries = await downloadSelf(options);
      for (const summary of summaries) printSummary("self", summary);
      return 0;
    }
    const summary = await downloadProfile(target, options);
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
