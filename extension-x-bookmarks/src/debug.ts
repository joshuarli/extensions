import { readXProfileLastCapture, readXProfileUnmatchedOps, type UnmatchedOperation } from "./background.ts";
import { readCredentials, readProfileTarget, type Credentials, type ProfileTarget } from "./capture.ts";
import { type MediaExportResult } from "./profile-export.ts";

export interface DebugStatusEntry {
  text: string;
  at: string;
}

export const statusLogKey = "x_archive_status_log";
const STATUS_LOG_LIMIT = 40;

export async function recordStatusEntry(text: string): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(statusLogKey))[statusLogKey];
    const list = Array.isArray(stored) ? stored : [];
    const next = [...list, { text, at: new Date().toISOString() }].slice(-STATUS_LOG_LIMIT);
    await chrome.storage.local.set({ [statusLogKey]: next });
  } catch { /* Diagnostics must never break the run they observe. */ }
}

export async function readStatusLog(): Promise<DebugStatusEntry[]> {
  const stored = (await chrome.storage.local.get(statusLogKey))[statusLogKey];
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry): DebugStatusEntry[] => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    return typeof record["text"] === "string" && typeof record["at"] === "string"
      ? [{ text: record["text"], at: record["at"] }]
      : [];
  }).slice(-STATUS_LOG_LIMIT);
}

export async function clearStatusLog(): Promise<void> {
  try {
    await chrome.storage.local.remove(statusLogKey);
  } catch { /* Diagnostics must never break the run they observe. */ }
}

export const lastErrorKey = "x_profile_last_error";

export interface LastErrorEntry {
  label: string;
  message: string;
  at: string;
}

export async function recordLastError(label: string, message: string): Promise<void> {
  try {
    await chrome.storage.local.set({
      [lastErrorKey]: { label, message, at: new Date().toISOString() },
    });
  } catch { /* Diagnostics must never break the run they observe. */ }
}

export async function readLastError(): Promise<LastErrorEntry | null> {
  const stored = (await chrome.storage.local.get(lastErrorKey))[lastErrorKey];
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if (typeof record["label"] !== "string" || typeof record["message"] !== "string" || typeof record["at"] !== "string") {
    return null;
  }
  return { label: record["label"], message: record["message"], at: record["at"] };
}

export async function clearLastError(): Promise<void> {
  try {
    await chrome.storage.local.remove(lastErrorKey);
  } catch { /* Diagnostics must never break the run they observe. */ }
}

export function credentialsSummary(credentials: Credentials): Record<string, {
  queryId: string;
  features: string | null;
  field_toggles_present: boolean;
  authorization_present: boolean;
  client_uuid_present: boolean;
  transaction_id_present: boolean;
}> {
  return Object.fromEntries(Object.entries(credentials.queryIds).sort(([a], [b]) => a.localeCompare(b)).map(([operation, queryId]) => [operation, {
    queryId,
    features: credentials.features[operation] ?? null,
    field_toggles_present: !!credentials.fieldToggles?.[operation],
    authorization_present: !!credentials.authorization,
    client_uuid_present: !!credentials.clientUuid,
    transaction_id_present: !!credentials.transactionId,
  }]));
}

export interface DebugReportInput {
  accountId: string;
  requestedProfile: string | undefined;
  exportFolder: string;
  extensionVersion: string;
  archive: unknown;
  media: MediaExportResult | null;
  reportName?: string;
  statusLog?: readonly DebugStatusEntry[];
}

export interface DebugReport {
  tool: string;
  exported_at: string;
  extension_version: string;
  account_id: string;
  requested_profile: string | null;
  export_folder: string;
  stored_target: ProfileTarget | null;
  last_capture: Awaited<ReturnType<typeof readXProfileLastCapture>>;
  unmatched_operations: UnmatchedOperation[];
  credentials: ReturnType<typeof credentialsSummary>;
  profile: unknown;
  collection: unknown;
  stats: unknown;
  archive_meta: unknown;
  media: {
    total: number;
    downloaded: number;
    stopped: boolean;
    failed: Array<{ filename: string; error: string }>;
  } | null;
  last_error: LastErrorEntry | null;
  status_log: DebugStatusEntry[];
  privacy_note: string;
}

export async function buildDebugReport(input: DebugReportInput): Promise<DebugReport> {
  const [credentials, storedTarget, lastCapture, unmatchedOps, lastError, storedStatusLog] = await Promise.all([
    readCredentials(input.accountId),
    readProfileTarget(input.accountId),
    readXProfileLastCapture(),
    readXProfileUnmatchedOps(),
    readLastError(),
    readStatusLog(),
  ]);
  const statusLog = input.statusLog ?? storedStatusLog;
  return {
    tool: input.reportName ?? "x-profile-posts-debug",
    exported_at: new Date().toISOString(),
    extension_version: input.extensionVersion,
    account_id: input.accountId,
    requested_profile: input.requestedProfile ?? null,
    export_folder: input.exportFolder,
    stored_target: storedTarget,
    last_capture: lastCapture,
    unmatched_operations: unmatchedOps,
    credentials: credentialsSummary(credentials),
    profile: (input.archive as Record<string, unknown> | null)?.["profile"] ?? null,
    collection: (input.archive as Record<string, unknown> | null)?.["collection"] ?? null,
    stats: (input.archive as Record<string, unknown> | null)?.["stats"] ?? null,
    archive_meta: input.archive,
    media: input.media
      ? {
        total: input.media.total,
        downloaded: input.media.downloaded,
        stopped: input.media.stopped,
        failed: input.media.failed,
      }
      : null,
    last_error: lastError,
    status_log: statusLog.slice(-40),
    privacy_note: "No authorization headers, cookies, or CSRF tokens are included. Query IDs and client feature flags are public X web-app configuration, included for shape-drift debugging.",
  };
}
