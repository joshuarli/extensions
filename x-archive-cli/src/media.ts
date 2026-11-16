import { mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { type MediaJob } from "../../x-archive-core/src/media.ts";
import { type MediaExportResult, type MediaExportProgress } from "../../x-archive-core/src/export-types.ts";
import { cookieHeaders, type XSession } from "./deps.ts";

const CONCURRENCY = 4;
const MIN_BYTES = 512;

function fixPhotoUrl(url: string): string {
  const match = /^(https:\/\/pbs\.twimg\.com\/media\/[^?]+)\.(png|webp|gif)\?format=jpg(&name=orig)?$/u.exec(url);
  if (match) return match[1] + "." + match[2] + "?format=" + match[2] + "&name=orig";
  return url;
}

export function filterCompletedMedia(jobs: readonly MediaJob[], folder: string): MediaJob[] {
  return jobs.filter((job) => !existsSync(join(folder, "media", job.filename)));
}

async function fetchOne(
  session: XSession,
  folder: string,
  job: MediaJob,
  attempts: number,
): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const target = join(folder, "media", job.filename);
  const temporary = target + ".part";
  let lastError = "unknown";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(fixPhotoUrl(job.url), {
        headers: cookieHeaders(session),
        signal: AbortSignal.timeout(120_000),
        redirect: "follow",
      });
      const status = response.status;
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const body = Buffer.from(await response.arrayBuffer());
      if (status !== 200) {
        lastError = "HTTP " + status;
        continue;
      }
      if (type.startsWith("text/") || type === "application/json" || type === "application/xml") {
        lastError = "error page served as " + (type || "unknown type");
        continue;
      }
      if (body.length < MIN_BYTES) {
        lastError = "suspiciously small body (" + body.length + " bytes)";
        continue;
      }
      mkdirSync(join(folder, "media"), { recursive: true });
      writeFileSync(temporary, body, { mode: 0o644 });
      renameSync(temporary, target);
      return { ok: true, bytes: body.length };
    } catch (error) {
      lastError = String(error instanceof Error ? error.message : error).slice(0, 160);
      try {
        unlinkSync(temporary);
      } catch { /* The partial file is the thing we are removing. */ }
    }
  }
  return { ok: false, error: lastError };
}

export interface MediaDownloadOptions {
  session: XSession;
  folder: string;
  onProgress?: (progress: MediaExportProgress) => void;
}

export async function downloadPostsMedia(
  jobs: readonly MediaJob[],
  options: MediaDownloadOptions,
): Promise<MediaExportResult> {
  const { session, folder } = options;
  mkdirSync(join(folder, "media"), { recursive: true });
  const failed: Array<{ filename: string; error: string }> = [];
  let downloaded = 0;
  let cursor = 0;
  const total = jobs.length;
  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index]!;
      const result = await fetchOne(session, folder, job, 3);
      if (result.ok) downloaded += 1;
      else failed.push({ filename: job.filename, error: result.error });
      options.onProgress?.({ downloaded, failed: failed.length, total });
    }
  });
  await Promise.all(workers);
  return { total, downloaded, failed, stopped: false };
}
