import { Effect } from "effect";
import { help, parseArgs, UsageError } from "./args.ts";
import { save } from "./save.ts";

try {
  const command = parseArgs(process.argv.slice(2));
  if (command.kind === "help") process.stdout.write(help);
  else if (command.kind === "version") process.stdout.write("onefile 0.1.0\n");
  else {
    const path = await Effect.runPromise(Effect.tryPromise({ try: () => save(command.options), catch: (error) => error instanceof Error ? error : new Error(String(error)) }));
    process.stdout.write(`${path}\n`);
  }
} catch (error) {
  process.stderr.write(`onefile: ${error instanceof Error ? error.message : String(error)}${error instanceof UsageError ? "\nTry onefile --help." : ""}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
