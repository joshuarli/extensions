import type { Credentials, ProfileTarget } from "./capture.ts";
import type { MediaExportResult } from "./export-types.ts";

export interface DebugStatusEntry {
  text: string;
  at: string;
}

export interface LastErrorEntry {
  label: string;
  message: string;
  at: string;
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
  last_capture: { operation: string; targetUserId?: string; variables?: string; at: string } | null;
  unmatched_operations: Array<{ operation: string; variables?: string }>;
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


export interface DebugGathered {
  credentials: Credentials;
  storedTarget: ProfileTarget | null;
  lastCapture: { operation: string; targetUserId?: string; variables?: string; at: string } | null;
  unmatchedOps: Array<{ operation: string; variables?: string }>;
  lastError: LastErrorEntry | null;
  statusLog: DebugStatusEntry[];
}

export function buildDebugReport(input: DebugReportInput, gathered: DebugGathered): DebugReport {
  const statusLog = input.statusLog ?? gathered.statusLog;
  return {
    tool: input.reportName ?? "x-profile-posts-debug",
    exported_at: new Date().toISOString(),
    extension_version: input.extensionVersion,
    account_id: input.accountId,
    requested_profile: input.requestedProfile ?? null,
    export_folder: input.exportFolder,
    stored_target: gathered.storedTarget,
    last_capture: gathered.lastCapture,
    unmatched_operations: gathered.unmatchedOps,
    credentials: credentialsSummary(gathered.credentials),
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
    last_error: gathered.lastError,
    status_log: statusLog.slice(-40),
    privacy_note: "No authorization headers, cookies, or CSRF tokens are included. Query IDs and client feature flags are public X web-app configuration, included for shape-drift debugging.",
  };
}
