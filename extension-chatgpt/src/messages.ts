import { Schema } from "effect";

const base = {
  kind: Schema.Literal("chatgpt/api"),
  requestId: Schema.String,
};

export const CommandSchema = Schema.Union([
  Schema.Struct({ action: Schema.Literals(["delete", "archive", "unarchive"]), id: Schema.String }),
  Schema.Struct({ action: Schema.Literal("rename"), id: Schema.String, title: Schema.String }),
  Schema.Struct({ action: Schema.Literal("move"), id: Schema.String, project: Schema.String }),
]);

// Every operation after "session" names the account it is for, so nothing is read or
// written for an account other than the one the dashboard loaded.
// A change names a chat in an armed run. It carries no body: the content script writes
// the command that was armed for that chat.
export const ApiRequestSchema = Schema.Union([
  Schema.Struct({ ...base, op: Schema.Literal("session") }),
  Schema.Struct({ ...base, op: Schema.Literal("list"), accountId: Schema.String, scope: Schema.Literals(["active", "archived"]) }),
  Schema.Struct({ ...base, op: Schema.Literal("projects"), accountId: Schema.String }),
  Schema.Struct({ ...base, op: Schema.Literal("conversation"), accountId: Schema.String, id: Schema.String }),
  Schema.Struct({ ...base, op: Schema.Literal("record"), accountId: Schema.String, id: Schema.String }),
  Schema.Struct({ ...base, op: Schema.Literal("probe"), accountId: Schema.String, id: Schema.String }),
  Schema.Struct({ ...base, op: Schema.Literal("change"), runId: Schema.String, leaseId: Schema.NonEmptyString, accountId: Schema.String, id: Schema.String }),
  Schema.Struct({
    ...base,
    op: Schema.Literal("arm"),
    runId: Schema.String,
    leaseId: Schema.NonEmptyString,
    accountId: Schema.String,
    commands: Schema.Array(CommandSchema),
  }),
]);

export type ApiRequest = Schema.Schema.Type<typeof ApiRequestSchema>;

// While a dashboard holds this port open for a run, the run may be armed; closing it disarms.
export const LEASE_PORT_PREFIX = "chatgpt/lease:";

export const FailurePayloadSchema = Schema.Struct({
  kind: Schema.String,
  message: Schema.String,
  until: Schema.Number,
});

export type FailurePayload = Schema.Schema.Type<typeof FailurePayloadSchema>;

export const ApiResponseSchema = Schema.Struct({
  kind: Schema.Literal("chatgpt/api:response"),
  requestId: Schema.String,
  ok: Schema.Boolean,
  value: Schema.Unknown,
  error: Schema.Union([FailurePayloadSchema, Schema.Null]),
});

export type ApiResponse = Schema.Schema.Type<typeof ApiResponseSchema>;

const NullableString = Schema.Union([Schema.String, Schema.Null]);

export const ChatSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdMs: Schema.Number,
  updatedMs: Schema.Number,
  projectId: NullableString,
  gptId: NullableString,
  pinned: Schema.Boolean,
  archived: Schema.Boolean,
});

export const SessionSchema = Schema.Struct({ accountId: Schema.String });

export const ChatListSchema = Schema.Struct({
  chats: Schema.Array(ChatSchema),
  complete: Schema.Boolean,
  total: Schema.Union([Schema.Number, Schema.Null]),
});

export const ProjectListSchema = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }));

export const ConversationSchema = Schema.Struct({
  title: Schema.String,
  messages: Schema.Array(Schema.Struct({
    role: Schema.Literals(["user", "assistant"]),
    text: Schema.String,
    timeMs: Schema.Number,
  })),
  search: Schema.String,
});

export const ConversationProbeSchema = Schema.Struct({
  archived: Schema.Boolean,
  visible: Schema.Boolean,
  projectId: Schema.optionalKey(NullableString),
  title: NullableString,
});

export function decodeValue<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
}

export function isPingRequest(message: unknown): message is "chatgpt/ping" {
  return message === "chatgpt/ping";
}

export function isApiRequest(message: unknown): message is ApiRequest {
  try {
    Schema.decodeUnknownSync(ApiRequestSchema, { onExcessProperty: "error" })(message);
    return true;
  } catch {
    return false;
  }
}

export function decodeApiResponse(message: unknown): ApiResponse | null {
  try {
    return Schema.decodeUnknownSync(ApiResponseSchema, { onExcessProperty: "error" })(message);
  } catch {
    return null;
  }
}

export const ListProgressSchema = Schema.Struct({
  kind: Schema.Literal("chatgpt/list-progress"),
  scope: Schema.Literals(["active", "archived"]),
  found: Schema.Number,
  total: Schema.Union([Schema.Number, Schema.Null]),
  waiting: Schema.Boolean,
});

export type ListProgress = Schema.Schema.Type<typeof ListProgressSchema>;

export function decodeListProgress(message: unknown): ListProgress | null {
  try {
    return Schema.decodeUnknownSync(ListProgressSchema, { onExcessProperty: "error" })(message);
  } catch {
    return null;
  }
}
