import { join } from "node:path";
import type {
  ChatgptArchive,
  ChatRef,
  MediaManifest,
  Session,
} from "../../chatgpt-archive-core/src/index.ts";
import { archiveDir, readArchiveState, readRecordLines, writeArchiveState } from "./state.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { DownloadOptions } from "./args.ts";
import { collectMediaJobs, downloadMediaJobs } from "./media.ts";
import { sha256Hex, type ArchiveFs } from "./storage.ts";

export interface RunInput {
  readonly options: DownloadOptions;
}

export interface RunDeps {
  readonly archive: ChatgptArchive;
  readonly fs: ArchiveFs;
  readonly reporter: ProgressReporter;
  readonly now: () => number;
  readonly signal?: AbortSignal;
}

export interface DownloadSummary {
  readonly written: number;
  readonly refreshed: number;
  readonly skipped: number;
  readonly total: number;
  readonly archived: number;
  readonly timeframe: string;
  readonly outputDir: string;
  readonly recordsPath: string;
  readonly manifestPath: string;
  readonly media: MediaManifest;
  readonly stopped: boolean;
}

interface ListResult {
  readonly chats: ChatRef[];
  readonly pages: number;
  readonly enumerated: boolean;
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

function needsRefresh(chat: ChatRef, line: string | undefined, archive: ChatgptArchive): boolean {
  if (line === undefined) return false;
  const saved = archive.decodeRecordLine(line);
  return saved === null || saved.updatedMs < chat.updatedMs || saved.title !== chat.title;
}

function isCovered(chat: ChatRef, line: string | undefined, archive: ChatgptArchive): boolean {
  if (line === undefined) return false;
  const saved = archive.decodeRecordLine(line);
  return saved !== null && saved.updatedMs >= chat.updatedMs && saved.title === chat.title;
}

export async function runDownload(input: RunInput, deps: RunDeps): Promise<DownloadSummary> {
  const { options } = input;
  const { archive, fs, reporter, signal } = deps;
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
  const session = await readSession(archive);
  reporter.update({ phase: "session", done: 1, total: 1, note: `account ${session.accountId}` });

  const outputDir = archiveDir(options.outRoot, session.accountId);
  const recordsPath = join(outputDir, "records.jsonl");
  const manifestPath = join(outputDir, "manifest.json");
  fs.mkdir(outputDir);

  const saved = readRecordLines(fs, recordsPath, archive);
  let state = readArchiveState(fs, options.outRoot, outputDir, session.accountId, archive);
  let stopped = false;

  async function listScope(scope: "active" | "archived"): Promise<ListResult> {
    let pages = 0;
    let listed = 0;
    let covered = false;
    const chats = await archive.list(scope, (page, total) => {
      pages++;
      listed += page.length;
      reporter.update({
        phase: "list " + scope,
        done: listed,
        total,
        note: page.at(-1)?.title,
      });
      if (state.scopes[scope].complete && page.every((chat) => isCovered(chat, saved.get(chat.id), archive))) {
        covered = true;
        return true;
      }
      return signal?.aborted === true;
    });
    return { chats, pages, enumerated: !covered };
  }

  let active: ListResult = { chats: [], pages: 0, enumerated: false };
  let archived: ListResult = { chats: [], pages: 0, enumerated: false };
  try {
    active = await listScope("active");
    if (options.includeArchived) archived = await listScope("archived");
    else reporter.update({ phase: "list archived", done: 0, total: 0, note: "disabled" });
  } catch (error) {
    if (signal === undefined || !signal.aborted) throw error;
    stopped = true;
  }

  const seen = new Set<string>();
  const candidates: ChatRef[] = [];
  for (const chat of [...active.chats, ...archived.chats]) {
    if (!archive.withinTimeframe(chat, options.sinceMs, options.untilMs, options.timeField)) continue;
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    const line = saved.get(chat.id);
    if (line !== undefined && !needsRefresh(chat, line, archive)) continue;
    candidates.push(chat);
  }
  const skipped = [...active.chats, ...archived.chats].filter((chat) => saved.has(chat.id)).length;
  const todo = options.limit === null ? candidates : candidates.slice(0, options.limit);

  let written = 0;
  let refreshed = 0;
  reporter.update({ phase: "records", done: 0, total: todo.length });
  try {
    for (let index = 0; index < todo.length; index++) {
      if (signal?.aborted) {
        stopped = true;
        break;
      }
      const chat = todo[index]!;
      reporter.update({ phase: "records", done: index, total: todo.length, note: chat.title });
      const wasSaved = saved.has(chat.id);
      const record = await archive.record(chat.id);
      const archivedRecord = await archive.toArchivedRecord(chat, record);
      const line = archive.encodeRecordLine(archivedRecord);
      fs.appendText(recordsPath, line + "\n");
      saved.set(chat.id, line);
      if (wasSaved) refreshed++;
      written++;
    }
  } catch (error) {
    if (signal === undefined || !signal.aborted) throw error;
    stopped = true;
  }
  reporter.update({ phase: "records", done: written, total: todo.length });

  let media: MediaManifest = { downloaded: 0, failed: 0, skipped: 0, errors: [], oversized: [] };
  if (options.noMedia) {
    reporter.update({ phase: "media", done: 0, total: 0, note: "disabled" });
  } else if (stopped) {
    reporter.update({ phase: "media", done: 0, total: 0, note: "stopped" });
  } else {
    media = await downloadMediaJobs({
      fs,
      archive,
      reporter,
      outputDir,
      jobs: collectMediaJobs(fs, recordsPath, archive),
      maxMediaBytes: options.maxMediaBytes,
      ...(signal === undefined ? {} : { signal }),
    });
  }
  if (signal?.aborted) stopped = true;

  const content = fs.readText(recordsPath) ?? "";
  const sha256OfRecords = await sha256Hex(content);
  const finalRecords = readRecordLines(fs, recordsPath, archive);
  const archivedIds = new Set(archived.chats.map((chat) => chat.id));
  const archivedCount = options.includeArchived
    ? Array.from(finalRecords.keys()).filter((id) => archivedIds.has(id)).length
    : 0;
  const manifest = archive.buildManifest({
    accountId: session.accountId,
    createdAt: new Date(deps.now()).toISOString(),
    since: options.since,
    until: options.until,
    timeField: options.timeField,
    total: finalRecords.size,
    archived: archivedCount,
    sha256OfRecords,
    media,
  });
  fs.writeText(manifestPath, manifest);
  reporter.update({ phase: "manifest", done: 1, total: 1 });

  const scopes = { ...state.scopes };
  for (const scope of ["active", "archived"] as const) {
    const result = scope === "active" ? active : archived;
    const previous = scopes[scope];
    const covered = result.chats.every((chat) => isCovered(chat, saved.get(chat.id), archive));
    scopes[scope] = {
      complete: previous.complete || (result.enumerated && covered && !stopped),
      scanned: previous.scanned + result.pages,
    };
  }
  state = { ...state, scopes };
  writeArchiveState(fs, outputDir, state);

  const summary: DownloadSummary = {
    written,
    refreshed,
    skipped,
    total: finalRecords.size,
    archived: archivedCount,
    timeframe: timeframeText(input),
    outputDir,
    recordsPath,
    manifestPath,
    media,
    stopped,
  };
  reporter.finish(
    `archived ${summary.written}, refreshed ${summary.refreshed}, skipped ${summary.skipped}, `
    + `media ${media.downloaded}/${media.failed}/${media.skipped}, output ${outputDir}`
    + (summary.stopped ? ", stopped" : ""),
  );
  return summary;
}

export function formatSummary(summary: DownloadSummary): string {
  const { downloaded, failed, skipped, oversized, errors } = summary.media;
  const shown = errors.slice(0, 2).map((failure) => `${failure.id} (${failure.error})`).join("; ");
  const failures = errors.length === 0
    ? ""
    : ` Failed media: ${shown}${errors.length > 2 ? ` and ${errors.length - 2} more` : ""}. See manifest.json for all failures.`;
  const capped = oversized.length === 0 ? "" : ` Oversized media: ${oversized.join(", ")}.`;
  const stopped = summary.stopped ? " Stopped early; rerun to resume." : "";
  return `Archived ${summary.written} conversation(s), refreshed ${summary.refreshed}, skipped ${summary.skipped} already saved. `
    + `Media: ${downloaded} downloaded, ${failed} failed, ${skipped} skipped.${failures}${capped}`
    + ` Timeframe: ${summary.timeframe}. Output: ${summary.outputDir}${stopped}`;
}
