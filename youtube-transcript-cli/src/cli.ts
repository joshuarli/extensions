import { writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { installInterrupt } from "../../lib/cli.ts";
import { help, parseArgs, UsageError } from "./args.ts";
import {
  fetchVideoTranscript,
  markdownTranscript,
} from "../../youtube-transcript-core/src/index.ts";

async function main(argv: string[]): Promise<number> {
  let command;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    throw error;
  }
  if (command.kind === "help") {
    process.stdout.write(help);
    return 0;
  }
  if (command.kind === "version") {
    process.stdout.write("youtube-transcript-cli 0.1.0\n");
    return 0;
  }
  try {
    const result = await Effect.runPromise(fetchVideoTranscript({
      url: command.options.url,
      language: command.options.language,
    }));
    const text = command.options.format === "srt"
      ? result.transcript.srt
      : command.options.format === "json"
        ? JSON.stringify(result, null, 2) + "\n"
        : markdownTranscript(result);
    if (command.options.out) {
      await writeFile(command.options.out, text, "utf8");
      process.stderr.write(command.options.out + "\n");
    } else {
      process.stdout.write(text);
    }
    return 0;
  } catch (error) {
    process.stderr.write("youtube-transcript failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  }
}

installInterrupt("Stopping the transcript fetch.");

const code = await main(process.argv.slice(2));
process.exit(code);
