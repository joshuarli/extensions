import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { createProgressReporter } from "../../lib/progress.ts";
import {
  abortableSleep,
  connectInstagram,
  InstagramRequestFailure,
  parksJob,
} from "../../instagram-client-core/src/index.ts";
import { parseArgs, USAGE, type CommandOptions } from "./args.ts";
import { buildSite } from "./build.ts";
import { createArchiveFs } from "./fs.ts";
import { getTarget, listCollectionKeys } from "./get.ts";
import { assertRunnable, clearJob, parkJob } from "./job.ts";
import { inspectArchive } from "./info.ts";
import { listFollowing } from "./following.ts";
import { scanTarget } from "./scan.ts";
import { collectionKey } from "./store.ts";

const INTERRUPT_MESSAGE = "Stopping after the current post or media file. Saved data is kept; re-running resumes. Ctrl-C again to force exit.";

function targetsFor(options: CommandOptions, accountId: string | undefined, fs: ReturnType<typeof createArchiveFs>): readonly string[] {
  if (options.targets.length > 0) return options.targets;
  if (accountId === undefined) return [];
  if (options.saved) return ["account"];
  return listCollectionKeys(fs, options.outRoot, accountId);
}

async function run(options: CommandOptions, signal: AbortSignal): Promise<number> {
  const fs = createArchiveFs();
  const reporter = createProgressReporter();
  assertRunnable(fs, options.outRoot, options.resume);

  if (options.command === "build") {
    const summary = buildSite(fs, options.outRoot, reporter);
    process.stdout.write(`Built ${summary.collections} collections and ${summary.posts} posts at ${summary.indexPath}\n`);
    return 0;
  }
  if (options.command === "info") {
    const info = inspectArchive(fs, options.outRoot);
    process.stdout.write(`${info.accounts} account(s), ${info.collections} collection(s), ${info.posts} post(s)\n`);
    for (const name of info.names) process.stdout.write("  " + name + "\n");
    return 0;
  }

  const client = await connectInstagram({
    backend: options.backend,
    session: options.session,
    cdpUrl: options.cdpUrl,
    signal,
    onStatus: (message) => process.stderr.write(message + "\n"),
  });
  try {
    const accountId = client.accountId;
    if (options.command === "following") {
      const names = await listFollowing(client, reporter, signal);
      process.stdout.write(names.join("\n") + (names.length > 0 ? "\n" : ""));
      return 0;
    }
    if (options.command === "follow") {
      throw new UsageError("follow is not available in this port. Archiving commands only read the account.\n\n" + USAGE);
    }
    if (options.command === "get-post") {
      throw new UsageError("get-post is not available in this port. Use scan @username instead.\n\n" + USAGE);
    }

    const targets = targetsFor(options, accountId, fs);
    if (targets.length === 0) throw new UsageError("No targets. Pass @username or --saved.\n\n" + USAGE);
    const now = () => Date.now();
    const pause = (pauseSignal: AbortSignal): Promise<void> => abortableSleep(options.pauseMs, pauseSignal);
    let written = 0;
    let downloaded = 0;
    let skipped = 0;

    for (const target of targets) {
      if (signal.aborted) break;
      const onPark = (failure: InstagramRequestFailure, collection: string, last: string | null): void => {
        parkJob(fs, options.outRoot, {
          reason: failure.kind,
          message: failure.message,
          operation: failure.operation,
          collection,
          lastCompleted: last,
          parkedAt: new Date(now()).toISOString(),
        });
      };
      if (options.command === "scan" || options.command === "update") {
        const summary = await scanTarget({
          target,
          saved: options.saved,
          outRoot: options.outRoot,
          accountId,
          limit: options.limit,
        }, { client, fs, reporter, now, signal, pause }, onPark);
        written += summary.written;
      }
      if (options.command === "get" || options.command === "update") {
        const key = collectionKey(target, options.saved).key;
        const summary = await getTarget({
          outRoot: options.outRoot,
          accountId,
          key,
          kind: options.saved ? "saved" : "profile",
          mediaDir: options.mediaDir,
          limit: options.limit,
          maxMediaBytes: options.maxMediaBytes,
        }, { client, fs, reporter, signal, pause }, onPark);
        downloaded += summary.downloaded;
        skipped += summary.skipped;
      }
    }
    clearJob(fs, options.outRoot);
    process.stdout.write(`${options.command}: ${written} post(s) recorded, ${downloaded} media file(s) downloaded, ${skipped} skipped.\n`);
    return signal.aborted ? 130 : 0;
  } finally {
    await client.close();
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
    process.stdout.write("instagram-archive 0.1.0\n");
    return 0;
  }
  try {
    return await run(command.options, interrupt.signal);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    if (error instanceof InstagramRequestFailure && parksJob(error)) {
      process.stderr.write("Instagram job parked: " + error.message + " Use --resume after resolving it.\n");
      return 3;
    }
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved data is kept; re-running resumes.\n");
      return 130;
    }
    process.stderr.write(`instagram-archive failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    interrupt.close();
  }
}
