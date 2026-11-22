import { join } from "node:path";
import type {
  ChatgptArchive,
  ChatRef,
  Session,
} from "../../chatgpt-archive-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { DownloadOptions } from "./args.ts";
import { sha256Hex, splitLines, type ArchiveFs } from "./storage.ts";

export interface RunInput {
  readonly options: DownloadOptions;
}

export interface RunDeps {
  readonly archive: ChatgptArchive;
  readonly fs: ArchiveFs;
  readonly reporter: ProgressReporter;
  readonly now: () => number;
}

export interface DownloadSummary {
  readonly written: number;
  readonly skipped: number;
  readonly total: number;
  readonly archived: number;
  readonly timeframe: string;
  readonly outputDir: string;
  readonly recordsPath: string;
  readonly manifestPath: string;
}

function readRecords(fs: ArchiveFs, path: string, archive: ChatgptArchive): Map<string, string> {
  const byId = new Map<string, string>();
  for (const line of splitLines(fs.readText(path) ?? "")) {
    const record = archive.decodeRecordLine(line);
    if (record !== null) byId.set(record.id, line);
  }
  return byId;
}

function timeframeText(input: RunInput): string {
  const { since, until, timeField } = input.options;
  if (since === null && until === null) return `${timeField}: any time`;
  return `${timeField}: ${since ?? "beginning"} .. ${until ?? "now"}`;
}

async function readSession(archive: ChatgptArchive): Promise<Session> {
  try {
    return await archive.session();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Not signed in to ChatGPT in the attached browser. Sign in at https://chatgpt.com/ in that browser, then rerun. (${detail})`);
  }
}

export async function runDownload(input: RunInput, deps: RunDeps): Promise<DownloadSummary> {
  const { options } = input;
  const { archive, fs, reporter } = deps;
  const session = await readSession(archive);
  reporter.update({ phase: "session", done: 1, total: 1, note: `account ${session.accountId}` });

  const stamp = new Date(deps.now()).toISOString().slice(0, 10);
  const outputDir = join(options.outRoot, `chatgpt-${stamp}`);
  const recordsPath = join(outputDir, "records.jsonl");
  const manifestPath = join(outputDir, "manifest.json");
  fs.mkdir(outputDir);

  const saved = readRecords(fs, recordsPath, archive);

  let listedActive = 0;
  const active = await archive.list("active", (page) => {
    listedActive += page.length;
    reporter.update({ phase: "list active", done: listedActive, total: null, note: page.at(-1)?.title });
  });
  reporter.update({ phase: "list active", done: active.length, total: active.length });

  let archived: ChatRef[] = [];
  if (options.includeArchived) {
    let listedArchived = 0;
    archived = await archive.list("archived", (page) => {
      listedArchived += page.length;
      reporter.update({ phase: "list archived", done: listedArchived, total: null, note: page.at(-1)?.title });
    });
    reporter.update({ phase: "list archived", done: archived.length, total: archived.length });
  } else {
    reporter.update({ phase: "list archived", done: 0, total: 0, note: "disabled" });
  }

  const seen = new Set<string>();
  const candidates: ChatRef[] = [];
  for (const chat of [...active, ...archived]) {
    if (!archive.withinTimeframe(chat, options.sinceMs, options.untilMs, options.timeField)) continue;
    if (saved.has(chat.id) || seen.has(chat.id)) continue;
    seen.add(chat.id);
    candidates.push(chat);
  }
  const skipped = new Set([...active, ...archived].filter((chat) => saved.has(chat.id)).map((chat) => chat.id)).size;
  const todo = options.limit === null ? candidates : candidates.slice(0, options.limit);

  for (let index = 0; index < todo.length; index++) {
    const chat = todo[index]!;
    reporter.update({ phase: "records", done: index, total: todo.length, note: chat.title });
    const record = await archive.record(chat.id);
    const archivedRecord = await archive.toArchivedRecord(chat, record);
    fs.appendText(recordsPath, archive.encodeRecordLine(archivedRecord) + "\n");
  }
  reporter.update({ phase: "records", done: todo.length, total: todo.length });

  const content = fs.readText(recordsPath) ?? "";
  const lineCount = splitLines(content).length;
  const sha256OfRecords = await sha256Hex(content);
  const archivedIds = new Set(archived.map((chat) => chat.id));
  const archivedCount = options.includeArchived
    ? Array.from(readRecords(fs, recordsPath, archive).keys()).filter((id) => archivedIds.has(id)).length
    : 0;
  const manifest = archive.buildManifest({
    accountId: session.accountId,
    createdAt: new Date(deps.now()).toISOString(),
    since: options.since,
    until: options.until,
    timeField: options.timeField,
    total: lineCount,
    archived: archivedCount,
    sha256OfRecords,
  });
  fs.writeText(manifestPath, manifest);
  reporter.update({ phase: "manifest", done: 1, total: 1 });

  const summary: DownloadSummary = {
    written: todo.length,
    skipped,
    total: lineCount,
    archived: archivedCount,
    timeframe: timeframeText(input),
    outputDir,
    recordsPath,
    manifestPath,
  };
  reporter.finish(`archived ${summary.written}, skipped ${summary.skipped}, output ${outputDir}`);
  return summary;
}

export function formatSummary(summary: DownloadSummary): string {
  return `Archived ${summary.written} conversation(s), skipped ${summary.skipped} already saved. `
    + `Timeframe: ${summary.timeframe}. Output: ${summary.outputDir}`;
}
