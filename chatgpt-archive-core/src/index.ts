import { sha256CanonicalJson } from "./hash.ts";
import {
  parseConversationsPage,
  parseRecordLine,
  parseSession,
  RECORD_LINE_FORMAT,
  RECORD_LINE_VERSION,
} from "./schema.ts";
import type {
  ArchiveDeps,
  ArchiveManifest,
  ArchivedRecord,
  ChatgptArchive,
  ChatRef,
  Session,
  TimeField,
} from "./types.ts";

export type {
  ArchiveDeps,
  ArchiveManifest,
  ArchivedRecord,
  ChatgptArchive,
  ChatRef,
  ChatgptTransport,
  Session,
  TimeField,
} from "./types.ts";

const LIMIT = 100;
const DEFAULT_REQUEST_GAP_MS = 1200;

export function createChatgptArchive(deps: ArchiveDeps): ChatgptArchive {
  const gap = deps.requestGapMs ?? DEFAULT_REQUEST_GAP_MS;
  let token: string | null = null;

  async function getJson(path: string, headers?: Record<string, string>): Promise<unknown> {
    await deps.sleep(gap);
    return headers === undefined
      ? deps.transport.getJson(path)
      : deps.transport.getJson(path, headers);
  }

  function requireToken(): string {
    if (token === null || token === "") {
      throw new Error("No ChatGPT access token. Call session() or setToken() first.");
    }
    return token;
  }

  return {
    setToken(value: string): void {
      if (typeof value !== "string" || value === "") {
        throw new Error("ChatGPT access token must be a non-empty string.");
      }
      token = value;
    },

    async session(): Promise<Session> {
      const session = parseSession(await getJson("/api/auth/session"));
      token = session.accessToken;
      return session;
    },

    async list(scope, onPage): Promise<ChatRef[]> {
      const authorization = "Bearer " + requireToken();
      const headers = { Authorization: authorization };
      const all: ChatRef[] = [];
      let offset = 0;
      for (;;) {
        const archived = scope === "archived" ? "&is_archived=true" : "";
        const path = "/backend-api/conversations?offset=" + offset + "&limit=" + LIMIT + "&order=updated" + archived;
        const page = parseConversationsPage(await getJson(path, headers), offset);
        if (onPage !== undefined) onPage(page.items);
        all.push(...page.items);
        if (page.items.length === 0) break;
        offset += page.items.length;
        if (offset >= page.total) break;
        if (page.items.length < LIMIT && !Number.isFinite(page.total)) break;
      }
      return all;
    },

    async record(id: string): Promise<unknown> {
      if (typeof id !== "string" || id === "") {
        throw new Error("Conversation id must be a non-empty string.");
      }
      const authorization = "Bearer " + requireToken();
      const value = await getJson("/backend-api/conversation/" + encodeURIComponent(id), {
        Authorization: authorization,
      });
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Conversation " + id + " did not return a record object.");
      }
      return value;
    },

    withinTimeframe(chat, sinceMs, untilMs, field: TimeField): boolean {
      const value = field === "created" ? chat.createdMs : chat.updatedMs;
      if (sinceMs !== null && value < sinceMs) return false;
      if (untilMs !== null && value > untilMs) return false;
      return true;
    },

    async toArchivedRecord(chat, record): Promise<ArchivedRecord> {
      const recordSha256 = await sha256CanonicalJson(record);
      return {
        id: chat.id,
        title: chat.title,
        createdMs: chat.createdMs,
        updatedMs: chat.updatedMs,
        url: "https://chatgpt.com/c/" + encodeURIComponent(chat.id),
        recordSha256,
        record,
      };
    },

    encodeRecordLine(record: ArchivedRecord): string {
      return JSON.stringify({
        format: RECORD_LINE_FORMAT,
        version: RECORD_LINE_VERSION,
        id: record.id,
        title: record.title,
        createdMs: record.createdMs,
        updatedMs: record.updatedMs,
        url: record.url,
        recordSha256: record.recordSha256,
        record: record.record,
      });
    },

    decodeRecordLine(line: string): ArchivedRecord | null {
      return parseRecordLine(line);
    },

    buildManifest(input: Omit<ArchiveManifest, "format" | "version">): string {
      const manifest: ArchiveManifest = {
        format: "chatgpt-archive",
        version: 1,
        accountId: input.accountId,
        createdAt: input.createdAt === "" ? new Date(deps.now()).toISOString() : input.createdAt,
        since: input.since,
        until: input.until,
        timeField: input.timeField,
        total: input.total,
        archived: input.archived,
        sha256OfRecords: input.sha256OfRecords,
      };
      return JSON.stringify(manifest, null, 2) + "\n";
    },
  };
}
