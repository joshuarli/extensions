import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { parseCliArgs, UsageError } from "../../lib/cli.ts";
import { fetchThread } from "../../hackernews-archive-core/src/client.ts";
import { renderThread } from "../../hackernews-archive-core/src/render.ts";
import { threadId } from "../../hackernews-archive-core/src/thread.ts";

const help = `hackernews-archive — archive a public Hacker News discussion

Usage:
  pnpm tools hn <item-url|id> [--format html|json] [--out FILE]

Defaults to standalone HTML on stdout. JSON contains the same item records.
Comment permalinks resolve to the containing discussion.
`;

export function parseArgs(argv: readonly string[]): { id: number; format: "html" | "json"; out: string | undefined } {
  const parsed = parseCliArgs(argv, { values: ["format", "out"], flags: [], maxPositionals: 1 });
  const id = threadId(parsed.positional[0] ?? "");
  if (id === undefined) throw new UsageError("Expected an HN item URL or positive integer item ID.");
  const format = parsed.values.get("format") ?? "html";
  if (format !== "html" && format !== "json") throw new UsageError("Expected --format html or json.");
  return { id, format, out: parsed.values.get("out") };
}

export async function main(argv: readonly string[]): Promise<number> {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    process.stdout.write("hackernews-archive-cli 0.1.0\n");
    return 0;
  }
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  try {
    const archive = await Effect.runPromise(fetchThread(options.id));
    const output = options.format === "json" ? JSON.stringify(archive, null, 2) + "\n" : renderThread(archive);
    if (options.out) {
      await writeFile(options.out, output, { encoding: "utf8", flag: "wx" });
      process.stderr.write(options.out + "\n");
    } else {
      process.stdout.write(output);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`hackernews-archive failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
