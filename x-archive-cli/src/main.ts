import { createInterruptController, dieBySignal, UsageError } from "../../lib/cli.ts";
import { parseArgs, USAGE } from "./args.ts";
import { resolveBackend } from "./backend.ts";
import { readBrowserSession } from "./deps.ts";
import { main as discoverMain } from "../../x-discovery-cli/src/main.ts";
import { downloadSocialLists } from "./social.ts";
import {
  downloadProfile,
  downloadSelf,
  printSummary,
  type RunOptions,
} from "./run.ts";

export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === "discover") return discoverMain(argv.slice(1));
  const interrupt = createInterruptController(
    "Stopping after the current page. Saved data is kept; re-running resumes. Ctrl-C again to force exit.",
  );
  const finish = (): number | Promise<never> => interrupt.stopped() ? dieBySignal(interrupt) : 0;
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
  if (command.kind === "lists") {
    try {
      const resolved = resolveBackend({
        backend: command.args.options.backend,
        session: command.args.options.session,
        cdpUrl: command.args.options.cdpUrl,
      });
      const session = await readBrowserSession(resolved.cdpUrl, resolved.backend);
      const social = await downloadSocialLists(session, {
        cdpUrl: resolved.cdpUrl,
        outRoot: command.args.options.outRoot,
        signal: interrupt.signal,
        backend: resolved.backend,
        onStatus: (text) => process.stderr.write(text + "\n"),
      });
      process.stdout.write(social.folder + "/following.json " + social.following + " users"
        + " · followers.json " + social.followers + " users · " + social.reason + "\n");
      return finish();
    } catch (error) {
      if (interrupt.stopped()) {
        process.stderr.write("Interrupted. Saved lists are kept; re-running resumes.\n");
        return dieBySignal(interrupt);
      }
      process.stderr.write("x lists failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
      return 1;
    } finally {
      interrupt.close();
    }
  }
  if (command.kind === "discover") return discoverMain(command.args);
  const { targets, options } = command.args;
  try {
    const resolved = resolveBackend({ backend: options.backend, session: options.session, cdpUrl: options.cdpUrl });
    const runOptions: RunOptions = {
      action: options.action,
      outRoot: options.outRoot,
      render: options.render,
      noContext: options.noContext,
      offline: options.offline,
      maxMediaBytes: options.maxMediaBytes,
      backend: resolved.backend,
      cdpUrl: resolved.cdpUrl,
      signal: interrupt.signal,
    };
    let completed = 0;
    const allFailures: string[] = [];
    for (const target of targets) {
      if (interrupt.stopped()) break;
      completed++;
      process.stderr.write(`[${completed}/${targets.length}] ${target}\n`);
      if (target === "self") {
        const summaries = await downloadSelf(runOptions);
        for (const summary of summaries) {
          printSummary("self", summary);
          allFailures.push(...summary.failures);
        }
      } else {
        const summary = await downloadProfile(target, runOptions);
        printSummary(target, summary);
        allFailures.push(...summary.failures);
      }
    }
    if (interrupt.stopped()) return dieBySignal(interrupt);
    if (allFailures.length > 0) {
      process.stderr.write("x completed with failures:\n" + allFailures.map((failure) => "  " + failure).join("\n") + "\n");
      return 1;
    }
    return finish();
  } catch (error) {
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved data is kept; re-running resumes.\n");
      return dieBySignal(interrupt);
    }
    process.stderr.write("x download failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  } finally {
    interrupt.close();
  }
}

