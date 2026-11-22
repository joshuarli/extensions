import { Schema } from "effect";
import type { ArchivedRecord, ChatRef, Session } from "./types.ts";

export const RECORD_LINE_FORMAT = "chatgpt-archive-record";
export const RECORD_LINE_VERSION = 1;

export const RecordLineSchema = Schema.Struct({
  format: Schema.Literal(RECORD_LINE_FORMAT),
  version: Schema.Literal(RECORD_LINE_VERSION),
  id: Schema.String,
  title: Schema.String,
  createdMs: Schema.Number,
  updatedMs: Schema.Number,
  url: Schema.String,
  recordSha256: Schema.String,
  record: Schema.Unknown,
});

export const SessionResponseSchema = Schema.Struct({
  user: Schema.Struct({ id: Schema.String }),
  accessToken: Schema.String,
});

const RowTimeSchema = Schema.Union([Schema.Number, Schema.String]);

export const ConversationRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.Union([Schema.String, Schema.Null]),
  create_time: Schema.NullOr(RowTimeSchema),
  update_time: Schema.NullOr(RowTimeSchema),
  is_archived: Schema.Boolean,
});

function toEpochMs(value: number | string | null): number {
  if (value === null) return 0;
  if (typeof value === "number") return Math.round(value * 1000);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid conversation timestamp: " + value);
  return parsed;
}

export const ConversationsPageSchema = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  total: Schema.Number,
});

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSession(value: unknown): Session {
  if (!isObject(value) || !isObject(value["user"]) ||
      typeof value["user"]["id"] !== "string" || value["user"]["id"] === "") {
    throw new Error("ChatGPT session is signed out or has no account id.");
  }
  if (typeof value["accessToken"] !== "string" || value["accessToken"] === "") {
    throw new Error("ChatGPT session response has no access token.");
  }
  const session = Schema.decodeUnknownSync(SessionResponseSchema)(value);
  return { accountId: session.user.id, accessToken: session.accessToken };
}

export function normalizeRow(raw: unknown, index: number, offset: number): ChatRef {
  try {
    const row = Schema.decodeUnknownSync(ConversationRowSchema)(raw);
    return {
      id: row.id,
      title: row.title ?? "",
      createdMs: toEpochMs(row.create_time),
      updatedMs: toEpochMs(row.update_time),
      archived: row.is_archived,
    };
  } catch {
    throw new Error("Malformed conversation row at index " + index + " in page at offset " + offset);
  }
}

export function parseConversationsPage(value: unknown, offset: number): { items: ChatRef[]; total: number } {
  let page: { readonly items: readonly unknown[]; readonly total: number };
  try {
    page = Schema.decodeUnknownSync(ConversationsPageSchema)(value);
  } catch {
    throw new Error("Malformed conversations response at offset " + offset);
  }
  const items = page.items.map((raw, index) => normalizeRow(raw, index, offset));
  return { items, total: page.total };
}

export function parseRecordLine(line: string): ArchivedRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  try {
    const record = Schema.decodeUnknownSync(RecordLineSchema)(value);
    return {
      id: record.id,
      title: record.title,
      createdMs: record.createdMs,
      updatedMs: record.updatedMs,
      url: record.url,
      recordSha256: record.recordSha256,
      record: record.record,
    };
  } catch {
    return null;
  }
}
