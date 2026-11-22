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

export interface FakeFs {
  files: Map<string, string>;
  bytes: Map<string, Uint8Array>;
  renames: Array<readonly [string, string]>;
}

export function createMemoryFs(files: Record<string, string> = {}): ArchiveFs & FakeFs {
  const filesByName = new Map(Object.entries(files));
  const bytesByName = new Map<string, Uint8Array>();
  const renames: Array<readonly [string, string]> = [];
  return {
    files: filesByName,
    bytes: bytesByName,
    renames,
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
    exists(path) {
      return filesByName.has(path) || bytesByName.has(path);
    },
    writeBytes(path, bytes) {
      bytesByName.set(path, bytes.slice());
      filesByName.delete(path);
    },
    rename(from, to) {
      if (filesByName.has(to) || bytesByName.has(to)) {
        throw new Error("Refusing to overwrite existing media file: " + to);
      }
      const data = bytesByName.get(from);
      if (data !== undefined) {
        bytesByName.delete(from);
        bytesByName.set(to, data);
      } else {
        const text = filesByName.get(from);
        if (text !== undefined) {
          filesByName.delete(from);
          filesByName.set(to, text);
        }
      }
      renames.push([from, to]);
    },
    remove(path) {
      bytesByName.delete(path);
      filesByName.delete(path);
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
  readonly records?: Readonly<Record<string, unknown>>;
  readonly media?: Readonly<Record<string, Uint8Array | Error>>;
  readonly mediaHandler?: (path: string) => Promise<Uint8Array>;
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
      const custom = options.records?.[id];
      return custom === undefined ? { id } : custom;
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
    async getMediaBytes(path) {
      if (options.mediaHandler !== undefined) return options.mediaHandler(path);
      const value = options.media?.[path];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error("No fake media for " + path);
      return value;
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
