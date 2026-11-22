import type {
  ArchivedRecord,
  ArchiveManifest,
  ChatgptArchive,
  ChatRef,
  Session,
  TimeField,
} from "../../chatgpt-archive-core/src/index.ts";
import type { ProgressReport, ProgressReporter } from "../../lib/progress.ts";
import type { ArchiveFs } from "../src/storage.ts";

export function createMemoryFs(files: Record<string, string> = {}): ArchiveFs & { files: Map<string, string> } {
  const filesByName = new Map(Object.entries(files));
  return {
    files: filesByName,
    mkdir() {},
    readText(path) {
      return filesByName.get(path) ?? null;
    },
    appendText(path, text) {
      filesByName.set(path, (filesByName.get(path) ?? "") + text);
    },
    writeText(path, text) {
      filesByName.set(path, text);
    },
  };
}

export function chat(id: string, title: string, createdMs: number, updatedMs = createdMs, archived = false): ChatRef {
  return { id, title, createdMs, updatedMs, archived };
}

export interface FakeArchiveOptions {
  readonly active?: readonly ChatRef[];
  readonly archived?: readonly ChatRef[];
  readonly session?: Session;
}

export function createFakeArchive(options: FakeArchiveOptions = {}): ChatgptArchive {
  const session: Session = options.session ?? { accountId: "account-1", accessToken: "token" };
  return {
    setToken() {},
    async session() {
      return session;
    },
    async list(scope, onPage) {
      const items = scope === "active" ? [...(options.active ?? [])] : [...(options.archived ?? [])];
      if (onPage !== undefined && items.length > 0) onPage(items);
      return items;
    },
    async record(id) {
      return { id };
    },
    withinTimeframe(value, sinceMs, untilMs, field: TimeField) {
      const time = field === "created" ? value.createdMs : value.updatedMs;
      if (sinceMs !== null && time < sinceMs) return false;
      if (untilMs !== null && time > untilMs) return false;
      return true;
    },
    async toArchivedRecord(value, record) {
      return {
        id: value.id,
        title: value.title,
        createdMs: value.createdMs,
        updatedMs: value.updatedMs,
        url: "https://chatgpt.com/c/" + value.id,
        recordSha256: "sha-" + value.id,
        record,
      } satisfies ArchivedRecord;
    },
    encodeRecordLine(record) {
      return JSON.stringify(record);
    },
    decodeRecordLine(line) {
      try {
        const value = JSON.parse(line) as { id?: unknown };
        return typeof value.id === "string" ? value as ArchivedRecord : null;
      } catch {
        return null;
      }
    },
    buildManifest(input) {
      const manifest = { format: "chatgpt-archive", version: 1, ...input } satisfies ArchiveManifest;
      return JSON.stringify(manifest, null, 2) + "\n";
    },
  };
}

export function lineFor(id: string, title: string, createdMs = 1, updatedMs = 1): string {
  const record: ArchivedRecord = {
    id,
    title,
    createdMs,
    updatedMs,
    url: "https://chatgpt.com/c/" + id,
    recordSha256: "sha-" + id,
    record: { id },
  };
  return JSON.stringify(record);
}

export function createReporter(): ProgressReporter & { reports: ProgressReport[] } {
  const reports: ProgressReport[] = [];
  return {
    reports,
    update(report) {
      reports.push(report);
    },
    finish() {},
  };
}
