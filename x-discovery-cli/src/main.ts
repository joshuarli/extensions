import { createInterruptController, UsageError } from "../../lib/cli.ts";
import { readBrowserSession } from "../../lib/x-session.ts";
import { parseArgs, USAGE } from "./args.ts";
import { bootstrapCandidates, buildReport, collectFeed, deriveFindings } from "./run.ts";
import { observeOperation } from "./observe.ts";
import { enrichCandidates } from "./enrich.ts";

export async function main(argv: readonly string[]): Promise<number> {
  const interrupt = createInterruptController(
    "Stopping after the current page. Saved pages, appearances and checkpoints are kept. Ctrl-C again to force exit.",
  );
  try {
    const command = parseArgs(argv);
    if (command.kind === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (command.kind === "version") {
      process.stdout.write("x-discovery-cli 0.2.0\n");
      return 0;
    }
    const { args } = command;
    const status = (message: string): void => { process.stderr.write(message + "\n"); };
    if (command.kind === "collect") {
      const summary = await collectFeed({
        outDir: args.outDir,
        maxPages: args.maxPages,
        feed: args.feed,
        signal: interrupt.signal,
        cdpUrl: args.cdpUrl,
        backend: args.backend,
        session: args.session,
        onStatus: status,
      });
      process.stdout.write("run=" + summary.runId + " account=" + summary.accountId
        + " pages=" + summary.pages + " posts=" + summary.posts + " new=" + summary.newPosts
        + " reason=" + summary.stopReason + "\n" + summary.outDir + "\n");
      return interrupt.stopped() ? 130 : 0;
    }
    if (command.kind === "derive") {
      const summary = await deriveFindings({ outDir: args.outDir, checkLinks: args.checkLinks });
      process.stdout.write("posts=" + summary.posts + " topics=" + summary.topics
        + " links=" + summary.links + " accounts=" + summary.accounts
        + " cached=" + summary.cached + (summary.linkChecks === null ? "" : " linkChecks=" + summary.linkChecks) + "\n");
      return 0;
    }
    if (command.kind === "report") {
      process.stdout.write(buildReport(args.outDir));
      return 0;
    }
    if (command.kind === "bootstrap") {
      const candidates = bootstrapCandidates(args.outDir);
      process.stdout.write("candidates=" + candidates.length + " " + args.outDir + "/candidates.json\n");
      return 0;
    }
    if (command.kind === "enrich") {
      const result = await enrichCandidates({
        outDir: args.outDir,
        handles: args.handles,
        maxPages: args.maxPages,
        cdpUrl: args.cdpUrl,
        backend: args.backend,
        session: args.session,
        signal: interrupt.signal,
        onStatus: status,
      });
      process.stdout.write("handles=" + result.handles + " posts=" + result.posts
        + " failures=" + result.failures.length + "\n");
      for (const failure of result.failures) process.stderr.write(failure + "\n");
      return interrupt.stopped() ? 130 : 0;
    }
    const session = await readBrowserSession(args.cdpUrl);
    const observed = await observeOperation({
      operation: "HomeTimeline",
      cdpUrl: args.cdpUrl,
      accountId: session.userId,
      outDir: args.outDir,
      signal: interrupt.signal,
      onStatus: status,
    });
    process.stdout.write("observations=" + observed.observations.length + " " + observed.recipePath + "\n");
    return interrupt.stopped() ? 130 : 0;
  } catch (error) {
    if (interrupt.stopped()) {
      process.stderr.write("Interrupted. Saved pages and checkpoints are kept; the next run starts at the head.\n");
      return 130;
    }
    if (error instanceof UsageError) {
      process.stderr.write(error.message + "\n");
      return 2;
    }
    process.stderr.write("x discover failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  } finally {
    interrupt.close();
  }
}
