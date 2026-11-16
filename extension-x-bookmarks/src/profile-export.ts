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
  const date = now.toISOString().slice(0, 10);
  const handle = screenName?.replace(/[^A-Za-z0-9._-]+/gu, "").replace(/^\.+/u, "").slice(0, 60) ?? "";
  return handle.length > 0 ? handle + "-" + date : "x-profile-" + userId + "-" + date;
}

export function bookmarksFolderName(now: Date = new Date()): string {
  return "bookmarks-" + now.toISOString().slice(0, 10);
}

export async function downloadPostsJson(json: string, folderName: string): Promise<string> {
  return downloadFolderFile(json, folderName, "posts.json");
}

export async function downloadDebugJson(json: string, folderName: string): Promise<string> {
  return downloadFolderFile(json, folderName, "debug.json");
}

function base64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return "data:application/json;base64," + btoa(binary);
}

export async function downloadFolderFile(json: string, folderName: string, file: string): Promise<string> {
  const filename = folderName + "/" + file;
  await chrome.downloads.download({ url: base64Url(json), filename, saveAs: false, conflictAction: "overwrite" });
  return filename;
}

const MEDIA_TIMEOUT_MS = 15 * 60_000;
const MEDIA_CONCURRENCY = 3;
const MEDIA_START_DELAY_MS = 150;
const MEDIA_RETRY_ROUNDS = 2;
const MEDIA_RETRY_DELAY_MS = 2_000;

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
  const jobsByFilename = new Map(jobs.map((job) => [job.filename, job]));
  const pending = new Map<number, string>();
  const failed: Array<{ filename: string; error: string }> = [];
  let downloaded = 0;
  let settled = false;
  let stopStarting = false;
  let started = 0;
  let workersDone = 0;
  let activeWorkers = workerCount;
  let attemptJobs: readonly MediaJob[] = jobs;
  let retriesLeft = MEDIA_RETRY_ROUNDS;

  return new Promise<MediaExportResult>((resolve) => {
    const reportProgress = () => {
      options.onProgress?.({ downloaded, failed: failed.length, total: jobs.length });
    };
    const startWorkers = (count: number): void => {
      for (let i = 0; i < count; i++) void worker();
    };
    const maybeFinish = () => {
      if (settled || workersDone < activeWorkers || pending.size > 0) return;
      if (!signal.aborted && retriesLeft > 0 && failed.length > 0) {
        const retried = failed.flatMap((failure) => {
          const job = jobsByFilename.get(failure.filename);
          return job ? [job] : [];
        });
        if (retried.length > 0) {
          retriesLeft -= 1;
          failed.length = 0;
          attemptJobs = retried;
          started = 0;
          workersDone = 0;
          stopStarting = false;
          activeWorkers = Math.min(MEDIA_CONCURRENCY, attemptJobs.length);
          options.report("Retrying " + attemptJobs.length + " failed media download" + (attemptJobs.length === 1 ? "" : "s") + ".");
          reportProgress();
          setTimeout(() => startWorkers(activeWorkers), MEDIA_RETRY_DELAY_MS);
          return;
        }
      }
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
      stopStarting = true;
      for (const filename of pending.values()) {
        failed.push({ filename, error: "Timed out waiting for the download to finish." });
      }
      pending.clear();
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      options.report("Media download timed out; no new files will start.");
      reportProgress();
      resolve({ total: jobs.length, downloaded, failed, stopped: true });
    }, options.timeoutMs ?? MEDIA_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);

    const worker = async (): Promise<void> => {
      while (!signal.aborted && !stopStarting && started < attemptJobs.length) {
        const job = attemptJobs[started];
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
    startWorkers(activeWorkers);
  });
}
export async function filterAlreadyDownloadedMedia(
  jobs: readonly MediaJob[],
  folderName: string,
  report: (message: string) => void,
): Promise<MediaJob[]> {
  try {
    const history = await chrome.downloads.search({
      query: [folderName + "/media/"],
      state: "complete",
      limit: 10000,
    });
    if (!Array.isArray(history) || history.length === 0) return [...jobs];
    const suffixes = new Set(history
      .map((item) => (typeof item?.filename === "string" ? item.filename : ""))
      .filter(Boolean));
    const remaining = jobs.filter((job) => {
      const suffix = folderName + "/media/" + job.filename;
      for (const filename of suffixes) {
        if (filename.endsWith(suffix)) return false;
      }
      return true;
    });
    if (remaining.length < jobs.length) {
      report("Skipping " + (jobs.length - remaining.length) + " media files already downloaded; fetching " + remaining.length + " remaining.");
    }
    return remaining;
  } catch {
    return [...jobs];
  }
}
