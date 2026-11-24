import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";
import { isYouTubeUrl } from "../../youtube-transcript-core/src/index.ts";

export { UsageError };

export type OutputFormat = "markdown" | "srt" | "json";

export interface TranscriptOptions {
  readonly url: string;
  readonly language: string | undefined;
  readonly format: OutputFormat;
  readonly out: string | undefined;
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "transcript"; options: TranscriptOptions };

const options = [
  { name: "language", value: "CODE", description: "preferred transcript language, e.g. en or zh-CN" },
  { name: "format", value: "markdown|srt|json", description: "output format (default markdown)" },
  { name: "out", value: "FILE", description: "write to FILE instead of stdout" },
] as const;

const schema: ArgSchema = { values: options.map((option) => option.name), flags: [], maxPositionals: 1 };

export const help = `youtube-transcript — fetch a YouTube transcript from the terminal

Usage:
  youtube-transcript <url> [options]

Options:
${options.map((option) => `  --${option.name} ${option.value}  ${option.description}`).join("\n")}
  --help, -h  show help
  --version, -v  show version

Example:
  pnpm youtube https://www.youtube.com/watch?v=UH6HCSNs7Os --format=srt
`;

export function parseArgs(argv: string[]): Command {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) return { kind: "version" };
  const parsed = parseCliArgs(argv, schema),
    url = parsed.positional[0];
  if (!url || !isYouTubeUrl(url)) throw new UsageError("Expected a YouTube URL as the only positional argument.");
  const format = parsed.values.get("format") ?? "markdown";
  if (format !== "markdown" && format !== "srt" && format !== "json") {
    throw new UsageError(`Unknown format: ${format} (expected markdown, srt, or json).`);
  }
  return { kind: "transcript", options: {
    url,
    language: parsed.values.get("language"),
    format,
    out: parsed.values.get("out"),
  } };
}
