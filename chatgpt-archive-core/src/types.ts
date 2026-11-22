export interface ChatgptTransport {
  getJson(path: string, headers?: Record<string, string>): Promise<unknown>;
}

export interface ArchiveDeps {
  transport: ChatgptTransport;
  sleep(ms: number): Promise<void>;
  now(): number;
  requestGapMs?: number;
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
}

export interface ChatgptArchive {
  setToken(token: string): void;
  session(): Promise<Session>;
  list(scope: "active" | "archived", onPage?: (chats: ChatRef[]) => void): Promise<ChatRef[]>;
  record(id: string): Promise<unknown>;
  withinTimeframe(chat: ChatRef, sinceMs: number | null, untilMs: number | null, field: TimeField): boolean;
  toArchivedRecord(chat: ChatRef, record: unknown): Promise<ArchivedRecord>;
  encodeRecordLine(record: ArchivedRecord): string;
  decodeRecordLine(line: string): ArchivedRecord | null;
  buildManifest(input: Omit<ArchiveManifest, "format" | "version">): string;
}
