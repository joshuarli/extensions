import { installInterrupt, UsageError } from "../../lib/cli.ts";
import { createProgressReporter } from "../../lib/progress.ts";
import { parseArgs, USAGE, type DownloadOptions } from "./args.ts";
import { resolveBackend } from "./backend.ts";
import { formatSummary, runDownload } from "./download.ts";
import { createNodeArchiveFs } from "./storage.ts";

async function download(options: DownloadOptions): Promise<number> {
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
      transport: createPageTransport(connection),
      sleep: (ms) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
      now: () => Date.now(),
    });
    const summary = await runDownload(
      { options },
      {
        archive,
        fs: createNodeArchiveFs(),
        reporter: createProgressReporter(),
        now: () => Date.now(),
      },
    );
    process.stdout.write(formatSummary(summary) + "\n");
    return 0;
  } finally {
    await connection.close();
  }
}

async function main(argv: readonly string[]): Promise<number> {
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
    process.stdout.write("chatgpt-archive-cli 0.1.0\n");
    return 0;
  }
  try {
    return await download(command.options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`chatgpt-archive download failed: ${detail}\n`);
    return 1;
  }
}

installInterrupt("Stopping. Saved records are kept; rerun this command to resume from the last completed record.");

const code = await main(process.argv.slice(2));
process.exit(code);
