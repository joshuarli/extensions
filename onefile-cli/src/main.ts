import { Effect } from "effect";
import { createInterruptController } from "../../lib/cli.ts";
import { help, parseArgs, UsageError } from "./args.ts";
import { save } from "./save.ts";

export async function main(argv: readonly string[]): Promise<number> {
  const interrupt = createInterruptController("Interrupted; closing the capture tab.");
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
      try: () => save(command.options, interrupt.signal),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    }));
    if (interrupt.stopped()) return 130;
    process.stdout.write(`${path}\n`);
    return 0;
  } catch (error) {
    if (interrupt.stopped()) return 130;
    process.stderr.write(`onefile: ${error instanceof Error ? error.message : String(error)}${error instanceof UsageError ? "\nTry onefile --help." : ""}\n`);
    return error instanceof UsageError ? 2 : 1;
  } finally {
    interrupt.close();
  }
}

