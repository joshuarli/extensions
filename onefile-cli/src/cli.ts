import { Effect } from "effect";
import { installInterrupt } from "../../lib/cli.ts";
import { help, parseArgs, UsageError } from "./args.ts";
import { save } from "./save.ts";

async function main(argv: string[]): Promise<number> {
  try {
    const command = parseArgs(argv);
    if (command.kind === "help") {
      process.stdout.write(help);
      return 0;
    }
    if (command.kind === "version") {
      process.stdout.write("onefile 0.1.0\n");
      return 0;
    }
    const path = await Effect.runPromise(Effect.tryPromise({
      try: () => save(command.options),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }));
    process.stdout.write(`${path}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`onefile: ${error instanceof Error ? error.message : String(error)}${error instanceof UsageError ? "\nTry onefile --help." : ""}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

installInterrupt("Interrupted.");

process.exitCode = await main(process.argv.slice(2));
