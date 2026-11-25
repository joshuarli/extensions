import { join } from "node:path";
import {
  extractMediaJobs,
  type ArchivedRecord,
  type ChatgptArchive,
  type MediaFailure,
  type MediaJob,
  type MediaManifest,
} from "../../chatgpt-archive-core/src/index.ts";
import { mediaErrorBody } from "../../lib/media.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { ArchiveFs } from "./storage.ts";
import { splitLines } from "./storage.ts";

export const MEDIA_DIRECTORY = "media";
const MAX_CONCURRENCY = 4;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function discard(fs: ArchiveFs, path: string): void {
  try {
    fs.remove(path);
  } catch {
    return;
  }
}

export function collectMediaJobs(fs: ArchiveFs, recordsPath: string, archive: ChatgptArchive): MediaJob[] {
  const byId = new Map<string, MediaJob>();
  for (const line of splitLines(fs.readText(recordsPath) ?? "")) {
    const record: ArchivedRecord | null = archive.decodeRecordLine(line);
    if (record === null) continue;
    for (const job of extractMediaJobs(record.record)) {
      if (!byId.has(job.id)) byId.set(job.id, job);
    }
  }
  return Array.from(byId.values()).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export interface MediaDownloadDeps {
  readonly fs: ArchiveFs;
  readonly archive: ChatgptArchive;
  readonly reporter: ProgressReporter;
  readonly outputDir: string;
  readonly jobs: readonly MediaJob[];
  readonly maxMediaBytes: number;
  readonly signal?: AbortSignal;
}

export async function downloadMediaJobs(deps: MediaDownloadDeps): Promise<MediaManifest> {
  const { fs, archive, reporter, jobs, maxMediaBytes, signal } = deps;
  const mediaDir = join(deps.outputDir, MEDIA_DIRECTORY);
  fs.mkdir(mediaDir);
  reporter.update({ phase: "media", done: 0, total: jobs.length });

  let cursor = 0;
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const errors: MediaFailure[] = [];
  const oversized: string[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index]!;
      const target = join(mediaDir, job.filename);
      const part = target + ".part";
      if (fs.exists(target)) {
        skipped++;
      } else {
        try {
          const bytes = await archive.getMediaBytes(job.path);
          if (signal?.aborted) return;
          if (bytes.length === 0) throw new Error("empty media response");
          const errorBody = mediaErrorBody(bytes);
          if (errorBody !== null) throw new Error("media response is an error: " + errorBody);
          if (maxMediaBytes > 0 && bytes.length > maxMediaBytes) {
            oversized.push(job.id);
            skipped++;
          } else {
            fs.writeBytes(part, bytes);
            fs.rename(part, target);
            downloaded++;
          }
        } catch (error) {
          if (signal?.aborted) return;
          if (fs.exists(target)) {
            skipped++;
          } else {
            failed++;
            errors.push({ id: job.id, error: describeError(error) });
          }
        } finally {
          discard(fs, part);
        }
      }
      done++;
      reporter.update({ phase: "media", done, total: jobs.length, note: job.filename });
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, jobs.length) }, () => worker());
  await Promise.all(workers);
  const byId = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  errors.sort((left, right) => byId(left.id, right.id));
  oversized.sort(byId);
  return { downloaded, failed, skipped, errors, oversized };
}
