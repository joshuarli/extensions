import { type MediaJob } from "./media.ts";

export interface MediaExportProgress {
  downloaded: number;
  failed: number;
  total: number;
}

export interface MediaExportResult {
  total: number;
  downloaded: number;
  failed: Array<{ filename: string; error: string }>;
  stopped: boolean;
}

export function exportFolderName(screenName: string | null | undefined, userId: string, now: Date = new Date()): string {
  const handle = screenName?.replace(/[^A-Za-z0-9_-]/g, "") ?? "";
  const base = handle.length > 0 ? handle : userId;
  return "x-profile-" + base + "-" + now.toISOString().slice(0, 10);
}

export async function downloadPostsJson(json: string, folderName: string): Promise<string> {
  const filename = folderName + "/posts.json";
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "overwrite" });
    return filename;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  }
}

const MEDIA_TIMEOUT_MS = 15 * 60_000;
const MEDIA_CONCURRENCY = 3;
const MEDIA_START_DELAY_MS = 150;

export function downloadPostsMedia(
  jobs: readonly MediaJob[],
  folderName: string,
  options: {
    report: (message: string) => void;
    onProgress?: (progress: MediaExportProgress) => void;
    signal: AbortSignal;
    timeoutMs?: number;
  },
): Promise<MediaExportResult> {
  const { signal } = options;
  const workerCount = Math.min(MEDIA_CONCURRENCY, jobs.length);
  const pending = new Map<number, string>();
  const failed: Array<{ filename: string; error: string }> = [];
  let downloaded = 0;
  let settled = false;
  let started = 0;
  let workersDone = 0;

  return new Promise<MediaExportResult>((resolve) => {
    const reportProgress = () => {
      options.onProgress?.({ downloaded, failed: failed.length, total: jobs.length });
    };
    const maybeFinish = () => {
      if (settled || workersDone < workerCount || pending.size > 0) return;
      settled = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve({ total: jobs.length, downloaded, failed, stopped: signal.aborted });
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      const filename = pending.get(delta.id ?? -1);
      if (filename === undefined) return;
      if (delta.state?.current === "complete") {
        pending.delete(delta.id ?? -1);
        downloaded += 1;
      } else if (delta.state?.current === "interrupted") {
        pending.delete(delta.id ?? -1);
        failed.push({ filename, error: delta.error?.current ?? "interrupted" });
        options.report("Media download failed: " + filename);
      } else {
        return;
      }
      const settledCount = downloaded + failed.length;
      if (settledCount % 25 === 0 || settledCount === jobs.length) {
        options.report("Media settled: " + settledCount + "/" + jobs.length + ".");
      }
      reportProgress();
      maybeFinish();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      for (const filename of pending.values()) {
        failed.push({ filename, error: "Timed out waiting for the download to finish." });
      }
      pending.clear();
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      options.report("Media download timed out; some files may still land in Downloads.");
      resolve({ total: jobs.length, downloaded, failed, stopped: signal.aborted });
    }, options.timeoutMs ?? MEDIA_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);

    const worker = async (): Promise<void> => {
      while (!signal.aborted && started < jobs.length) {
        const job = jobs[started];
        if (!job) break;
        started += 1;
        try {
          const id = await chrome.downloads.download({
            url: job.url,
            filename: folderName + "/media/" + job.filename,
            saveAs: false,
            conflictAction: "overwrite",
          });
          pending.set(id, job.filename);
        } catch (cause) {
          failed.push({ filename: job.filename, error: cause instanceof Error ? cause.message : String(cause) });
          options.report("Media download failed: " + job.filename);
        }
        reportProgress();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, MEDIA_START_DELAY_MS));
      }
      workersDone += 1;
      maybeFinish();
    };

    reportProgress();
    if (workerCount === 0) {
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve({ total: 0, downloaded: 0, failed: [], stopped: false });
      return;
    }
    for (let i = 0; i < workerCount; i++) void worker();
  });
}
