export interface ChatgptTransport {
  getJson(path: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<unknown>;
  getBytes?(path: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface MediaJob {
  readonly id: string;
  readonly filename: string;
  readonly path: string;
}

export interface MediaFailure {
  readonly id: string;
  readonly error: string;
}

export interface MediaManifest {
  readonly downloaded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errors: readonly MediaFailure[];
  readonly oversized: readonly string[];
}

export interface ArchiveDeps {
  transport: ChatgptTransport;
  sleep(ms: number): Promise<void>;
  now(): number;
  requestGapMs?: number;
  signal?: AbortSignal;
}

export interface Session {
  accountId: string;
  accessToken: string;
}

export interface ChatRef {
  id: string;
  title: string;
  createdMs: number;
  updatedMs: number;
  archived: boolean;
}

export type TimeField = "created" | "updated";

export interface ArchivedRecord {
  id: string;
  title: string;
  createdMs: number;
  updatedMs: number;
  url: string;
  recordSha256: string;
  record: unknown;
}

export interface ArchiveManifest {
  format: string;
  version: number;
  accountId: string;
  createdAt: string;
  since: string | null;
  until: string | null;
  timeField: TimeField;
  total: number;
  archived: number;
  sha256OfRecords: string;
  media?: MediaManifest | undefined;
}

export interface ScanCheckpoint {
  readonly complete: boolean;
  readonly scanned: number;
}

export interface ArchiveState {
  readonly format: string;
  readonly version: number;
  readonly accountId: string;
  readonly scopes: {
    readonly active: ScanCheckpoint;
    readonly archived: ScanCheckpoint;
  };
}

export interface ChatgptArchive {
  setToken(token: string): void;
  session(): Promise<Session>;
  list(scope: "active" | "archived", onPage?: (chats: ChatRef[], total: number) => boolean | void): Promise<ChatRef[]>;
  record(id: string): Promise<unknown>;
  withinTimeframe(chat: ChatRef, sinceMs: number | null, untilMs: number | null, field: TimeField): boolean;
  toArchivedRecord(chat: ChatRef, record: unknown): Promise<ArchivedRecord>;
  getMediaBytes(path: string): Promise<Uint8Array>;
  encodeRecordLine(record: ArchivedRecord): string;
  decodeRecordLine(line: string): ArchivedRecord | null;
  buildManifest(input: Omit<ArchiveManifest, "format" | "version">): string;
}
