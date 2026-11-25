import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { parseArgs, USAGE } from "./args.ts";
import { resolveBackend } from "./backend.ts";
import {
  downloadProfile,
  downloadSelf,
  printSummary,
  type RunOptions,
} from "./run.ts";

export async function main(argv: readonly string[]): Promise<number> {
  const interrupt = createInterruptController(
    "Stopping after the current page. Saved data is kept; re-running resumes. Ctrl-C again to force exit.",
  );
  let command: ReturnType<typeof parseArgs>;
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
    process.stdout.write(USAGE);
    return 0;
  }
  if (command.kind === "version") {
    process.stdout.write("x-archive-cli 0.1.0\n");
    return 0;
  }
  const { targets, options } = command.args;
  try {
    const resolved = resolveBackend({ backend: options.backend, session: options.session, cdpUrl: options.cdpUrl });
    const runOptions: RunOptions = {
      action: options.action,
      outRoot: options.outRoot,
      render: options.render,
      noContext: options.noContext,
      maxMediaBytes: options.maxMediaBytes,
      backend: resolved.backend,
      cdpUrl: resolved.cdpUrl,
      signal: interrupt.signal,
    };
    let completed = 0;
    for (const target of targets) {
      if (interrupt.stopped()) break;
      completed++;
      process.stderr.write(`[${completed}/${targets.length}] ${target}\n`);
      if (target === "self") {
        const summaries = await downloadSelf(runOptions);
        for (const summary of summaries) printSummary("self", summary);
      } else {
        const summary = await downloadProfile(target, runOptions);
        printSummary(target, summary);
      }
    }
    return interrupt.stopped() ? 130 : 0;
  } catch (error) {
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved data is kept; re-running resumes.\n");
      return 130;
    }
    process.stderr.write("x download failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  } finally {
    interrupt.close();
  }
}

