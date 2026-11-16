import { readXProfileLastCapture, readXProfileUnmatchedOps, type UnmatchedOperation } from "./background.ts";
import { readCredentials, readProfileTarget } from "./capture.ts";
import { type DebugStatusEntry, type LastErrorEntry } from "../../x-archive-core/src/debug.ts";

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

export { credentialsSummary } from "../../x-archive-core/src/debug.ts";
export { buildDebugReport as buildCoreDebugReport } from "../../x-archive-core/src/debug.ts";
export type { DebugStatusEntry, LastErrorEntry, DebugReportInput, DebugReport, DebugGathered } from "../../x-archive-core/src/debug.ts";

import {
  buildDebugReport as coreBuild,
  type DebugReportInput,
  type DebugGathered,
} from "../../x-archive-core/src/debug.ts";

export async function buildDebugReport(input: DebugReportInput) {
  const [credentials, storedTarget, lastCapture, unmatchedOps, lastError, storedStatusLog] = await Promise.all([
    readCredentials(input.accountId),
    readProfileTarget(input.accountId),
    readXProfileLastCapture(),
    readXProfileUnmatchedOps(),
    readLastError(),
    readStatusLog(),
  ]);
  const gathered: DebugGathered = {
    credentials,
    storedTarget,
    lastCapture,
    unmatchedOps: unmatchedOps as UnmatchedOperation[],
    lastError,
    statusLog: storedStatusLog,
  };
  return coreBuild(input, gathered);
}
