import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MediaJob } from "../../x-archive-core/src/media.ts";
import { type MediaExportResult, type MediaExportProgress } from "../../x-archive-core/src/export-types.ts";
import { cookieHeaders, type XSession } from "./deps.ts";

const CONCURRENCY = 4;
const MIN_BYTES = 512;

type FetchResult =
  | { kind: "downloaded"; bytes: number }
  | { kind: "skipped"; bytes: number }
  | { kind: "failed"; error: string };

function fixPhotoUrl(url: string): string {
  const match = /^(https:\/\/pbs\.twimg\.com\/media\/[^?]+)\.(png|webp|gif)\?format=jpg(&name=orig)?$/u.exec(url);
  if (match) return match[1] + "." + match[2] + "?format=" + match[2] + "&name=orig";
  return url;
}

export function filterCompletedMedia(jobs: readonly MediaJob[], folder: string): MediaJob[] {
  return jobs.filter((job) => !existsSync(join(folder, "media", job.filename)));
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "unlimited";
  if (bytes % (1024 * 1024) === 0) return bytes / (1024 * 1024) + " MB";
  if (bytes % 1024 === 0) return bytes / 1024 + " KB";
  return bytes + " B";
}

function writeAll(handle: number, buffer: Buffer): void {
  let written = 0;
  while (written < buffer.length) {
    const count = writeSync(handle, buffer, written, buffer.length - written);
    if (count === 0) throw new Error("short write to media temporary file");
    written += count;
  }
}

function placeFile(temporary: string, target: string): void {
  try {
    renameSync(temporary, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const staging = target + ".part";
    copyFileSync(temporary, staging);
    renameSync(staging, target);
  }
}

async function fetchOne(
  session: XSession,
  tempDir: string,
  folder: string,
  job: MediaJob,
  attempts: number,
  maxBytes: number,
): Promise<FetchResult> {
  const target = join(folder, "media", job.filename);
  let lastError = "unknown";
  for (let attempt = 0; attempt < attempts; attempt++) {
    let temporary: string | null = null;
    let handle: number | null = null;
    try {
      const response = await fetch(fixPhotoUrl(job.url), {
        headers: cookieHeaders(session),
        signal: AbortSignal.timeout(120_000),
        redirect: "follow",
      });
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        lastError = "HTTP " + response.status;
        continue;
      }
      if (type.startsWith("text/") || type === "application/json" || type === "application/xml") {
        void response.body?.cancel().catch(() => {});
        lastError = "error page served as " + (type || "unknown type");
        continue;
      }
      const declared = Number(response.headers.get("content-length"));
      if (maxBytes > 0 && Number.isFinite(declared) && declared > maxBytes) {
        void response.body?.cancel().catch(() => {});
        return { kind: "skipped", bytes: declared };
      }

      temporary = join(tempDir, job.filename + "." + attempt + ".tmp");
      handle = openSync(temporary, "w", 0o644);
      const reader = response.body?.getReader();
      if (!reader) {
        lastError = "empty response body";
        continue;
      }
      let total = 0;
      let tooLarge = false;
      let readError: string | null = null;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          if (maxBytes > 0 && total + chunk.length > maxBytes) {
            tooLarge = true;
            break;
          }
          writeAll(handle, chunk);
          total += chunk.length;
        }
      } catch (error) {
        readError = String(error instanceof Error ? error.message : error).slice(0, 160);
      } finally {
        void reader.cancel().catch(() => {});
      }
      closeSync(handle);
      handle = null;
      if (readError) {
        lastError = readError;
        continue;
      }
      if (tooLarge) return { kind: "skipped", bytes: total };
      if (total < MIN_BYTES) {
        lastError = "suspiciously small body (" + total + " bytes)";
        continue;
      }
      mkdirSync(join(folder, "media"), { recursive: true });
      placeFile(temporary, target);
      temporary = null;
      return { kind: "downloaded", bytes: total };
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error).slice(0, 160);
    } finally {
      if (handle !== null) {
        closeSync(handle);
        handle = null;
      }
      if (temporary !== null) {
        try {
          unlinkSync(temporary);
        } catch { /* The temporary file is the thing we are removing. */ }
      }
    }
  }
  return { kind: "failed", error: lastError };
}

export interface MediaDownloadOptions {
  session: XSession;
  folder: string;
  maxBytes: number;
  onProgress?: (progress: MediaExportProgress) => void;
}

export async function downloadPostsMedia(
  jobs: readonly MediaJob[],
  options: MediaDownloadOptions,
): Promise<MediaExportResult> {
  const { session, folder, maxBytes } = options;
  mkdirSync(join(folder, "media"), { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "x-archive-media-"));
  const failed: Array<{ filename: string; error: string }> = [];
  const skipped: Array<{ filename: string; bytes: number }> = [];
  let downloaded = 0;
  let cursor = 0;
  const total = jobs.length;
  try {
    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const index = cursor;
        cursor += 1;
        const job = jobs[index]!;
        const result = await fetchOne(session, tempDir, folder, job, 3, maxBytes);
        if (result.kind === "downloaded") downloaded += 1;
        else if (result.kind === "skipped") skipped.push({ filename: job.filename, bytes: result.bytes });
        else failed.push({ filename: job.filename, error: result.error });
        options.onProgress?.({ downloaded, failed: failed.length, skipped: skipped.length, total });
      }
    });
    const settled = await Promise.allSettled(workers);
    const failure = settled.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return { total, downloaded, failed, skipped, stopped: false };
}
