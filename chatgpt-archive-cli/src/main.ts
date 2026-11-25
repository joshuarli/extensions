import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { createProgressReporter } from "../../lib/progress.ts";
import { parseArgs, USAGE, type DownloadOptions } from "./args.ts";
import { resolveBackend } from "./backend.ts";
import { formatSummary, runDownload } from "./download.ts";
import { createNodeArchiveFs } from "./storage.ts";

const INTERRUPT_MESSAGE = "Stopping after the current record or media file. Saved data is kept; re-running resumes. Ctrl-C again to force exit.";

async function download(options: DownloadOptions, signal: AbortSignal): Promise<number> {
  const resolved = resolveBackend({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
  });
  const { connectChatgpt, createPageTransport } = await import("./browser.ts");
  const { createChatgptArchive } = await import("../../chatgpt-archive-core/src/index.ts");
  const connection = await connectChatgpt(resolved.cdpUrl);
  try {
    const archive = createChatgptArchive({
      transport: createPageTransport(connection, signal),
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
      now: () => Date.now(),
      signal,
    });
    const summary = await runDownload(
      { options },
      {
        archive,
        fs: createNodeArchiveFs(),
        reporter: createProgressReporter(),
        now: () => Date.now(),
        signal,
      },
    );
    process.stdout.write(formatSummary(summary) + "\n");
    return summary.stopped ? 130 : 0;
  } finally {
    await connection.close();
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
