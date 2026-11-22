import { installInterrupt, UsageError } from "../../lib/cli.ts";
import { parseArgs, USAGE } from "./args.ts";
import { resolveBackend } from "./backend.ts";
import {
  downloadProfile,
  downloadSelf,
  printSummary,
  type RunOptions,
} from "./run.ts";

async function main(argv: string[]): Promise<number> {
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
  const { target, options } = command.args;
  try {
    const resolved = resolveBackend({ backend: options.backend, session: options.session, cdpUrl: options.cdpUrl });
    const runOptions: RunOptions = {
      action: options.action,
      outRoot: options.outRoot,
      render: options.render,
      noContext: options.noContext,
      backend: resolved.backend,
      cdpUrl: resolved.cdpUrl,
    };
    if (target === "self") {
      const summaries = await downloadSelf(runOptions);
      for (const summary of summaries) printSummary("self", summary);
      return 0;
    }
    const summary = await downloadProfile(target, runOptions);
    printSummary(target, summary);
    return 0;
  } catch (error) {
    process.stderr.write("x download failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  }
}

installInterrupt("Stopping after the current page. Re-running resumes from the saved checkpoint.");

const code = await main(process.argv.slice(2));
process.exit(code);
