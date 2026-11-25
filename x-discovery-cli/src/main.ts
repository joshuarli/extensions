import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { parseArgs, USAGE } from "./args.ts";
import { discover } from "./run.ts";

export async function main(argv: readonly string[]): Promise<number> {
  const interrupt = createInterruptController(
    "Stopping after the current page. Saved posts and the cursor are kept; re-running resumes.",
  );
  try {
    const command = parseArgs(argv);
    if (command.kind === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (command.kind === "version") {
      process.stdout.write("x-discovery-cli 0.1.0\n");
      return 0;
    }
    const summary = await discover({
      cdpUrl: command.cdpUrl,
      outDir: command.outDir,
      maxPages: command.maxPages,
      signal: interrupt.signal,
      onStatus: (message) => process.stderr.write(message + "\n"),
    });
    process.stdout.write(
      "pages=" + summary.pages + " posts=" + summary.posts + " new=" + summary.newPosts
      + " accounts=" + summary.accounts + " complete=" + summary.complete + " reason=" + summary.reason + "\n"
      + summary.outDir + "\n",
    );
    return interrupt.stopped() ? 130 : 0;
  } catch (error) {
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved posts and the cursor are kept; re-running resumes.\n");
      return 130;
    }
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    process.stderr.write("x-discover failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  } finally {
    interrupt.close();
  }
}
