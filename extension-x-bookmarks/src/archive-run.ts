export const archiveRunKey = "x_archive_run";
export const archiveStopKey = "x_archive_stop";

export type ArchiveRunJob = "profile" | "bookmarks" | "likes";
export type ArchiveRunAction = "collect" | "export" | "download";
export type ArchiveRunPhase = "collecting" | "exporting" | "done" | "error";

export interface ArchiveRunRecord {
  id: string;
  job: ArchiveRunJob;
  phase: ArchiveRunPhase;
  detail: string;
  posts: number;
  pages: number;
  mediaDownloaded?: number;
  mediaTotal?: number;
  folder?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const phaseNames = new Set(["collecting", "exporting", "done", "error"]);

export function decodeArchiveRun(value: unknown): ArchiveRunRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record["id"] !== "string" || typeof record["job"] !== "string") return null;
  if (record["job"] !== "profile" && record["job"] !== "bookmarks" && record["job"] !== "likes") return null;
  const phase = record["phase"];
  if (typeof phase !== "string" || !phaseNames.has(phase)) return null;
  if (typeof record["detail"] !== "string"
      || typeof record["posts"] !== "number"
      || typeof record["pages"] !== "number"
      || typeof record["startedAt"] !== "string"
      || typeof record["updatedAt"] !== "string") return null;
  return {
    id: record["id"],
    job: record["job"],
    phase: phase as ArchiveRunPhase,
    detail: record["detail"],
    posts: record["posts"],
    pages: record["pages"],
    ...(typeof record["mediaDownloaded"] === "number" ? { mediaDownloaded: record["mediaDownloaded"] } : {}),
    ...(typeof record["mediaTotal"] === "number" ? { mediaTotal: record["mediaTotal"] } : {}),
    ...(typeof record["folder"] === "string" ? { folder: record["folder"] } : {}),
    ...(typeof record["error"] === "string" ? { error: record["error"] } : {}),
    startedAt: record["startedAt"],
    updatedAt: record["updatedAt"],
  };
}

export async function readArchiveRun(): Promise<ArchiveRunRecord | null> {
  return decodeArchiveRun((await chrome.storage.local.get(archiveRunKey))[archiveRunKey]);
}

export async function writeArchiveRun(record: ArchiveRunRecord): Promise<void> {
  await chrome.storage.local.set({ [archiveRunKey]: record });
}

export async function patchArchiveRun(patch: Partial<ArchiveRunRecord>): Promise<void> {
  const current = await readArchiveRun();
  if (!current) return;
  await writeArchiveRun({
    ...current,
    ...patch,
    id: current.id,
    startedAt: current.startedAt,
    updatedAt: new Date().toISOString(),
  });
}

export async function readArchiveStop(): Promise<{ id: string } | null> {
  const record = asRecord((await chrome.storage.local.get(archiveStopKey))[archiveStopKey]);
  return record && typeof record["id"] === "string" ? { id: record["id"] } : null;
}

export async function writeArchiveStop(stop: { id: string }): Promise<void> {
  await chrome.storage.local.set({ [archiveStopKey]: stop });
}

export async function clearArchiveStop(): Promise<void> {
  await chrome.storage.local.remove(archiveStopKey);
}
