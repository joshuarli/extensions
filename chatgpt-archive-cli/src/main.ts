import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { createProgressReporter } from "../../lib/progress.ts";
import { connectChatgpt } from "../../chatgpt-client-core/src/index.ts";
import { parseArgs, USAGE, type DownloadOptions } from "./args.ts";
import { formatSummary, runDownload } from "./download.ts";
import { createNodeArchiveFs } from "./storage.ts";
import { knownAccountIds } from "./state.ts";

const INTERRUPT_MESSAGE = "Stopping after the current record or media file. Saved data is kept; re-running resumes. Ctrl-C again to force exit.";

async function download(options: DownloadOptions, signal: AbortSignal): Promise<number> {
  const fs = createNodeArchiveFs();
  const known = knownAccountIds(fs, options.outRoot);
  const client = await connectChatgpt({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
    ...(known.length === 1 ? { expectedAccountId: known[0] } : {}),
    signal,
    onStatus: (message) => process.stderr.write(message + "\n"),
  });
  try {
    const { createChatgptArchive } = await import("../../chatgpt-archive-core/src/index.ts");
    const archive = createChatgptArchive({
      transport: client.transport,
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
      now: () => Date.now(),
      signal,
    });
    const summary = await runDownload(
      { options },
      {
        archive,
        fs,
        reporter: createProgressReporter(),
        now: () => Date.now(),
        signal,
      },
    );
    process.stdout.write(formatSummary(summary) + "\n");
    return summary.stopped ? 130 : 0;
  } finally {
    await client.close().catch((error: unknown) => {
      process.stderr.write("Could not close the ChatGPT browser connection: " + String(error) + "\n");
    });
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const interrupt = createInterruptController(INTERRUPT_MESSAGE);
  let command: ReturnType<typeof parseArgs>;
  try {
    command = parseArgs(argv);
  } catch (error) {
    interrupt.close();
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    throw error;
  }
  if (command.kind === "help") {
    interrupt.close();
    process.stdout.write(USAGE);
    return 0;
  }
  if (command.kind === "version") {
    interrupt.close();
    process.stdout.write("chatgpt-archive-cli 0.1.0\n");
    return 0;
  }
  try {
    return await download(command.options, interrupt.signal);
  } catch (error) {
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved data is kept; re-running resumes.\n");
      return 130;
    }
    process.stderr.write(`chatgpt-archive download failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    interrupt.close();
  }
}
