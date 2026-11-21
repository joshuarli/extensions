import { Schema } from "effect";

const base = {
  kind: Schema.Literal("chatgpt/api"),
  requestId: Schema.String,
};

const MutatingActionSchema = Schema.Literals(["delete", "archive", "unarchive", "rename", "move"]);

export const ApiRequestSchema = Schema.Union([
  Schema.Struct({ ...base, op: Schema.Literal("session") }),
  Schema.Struct({ ...base, op: Schema.Literal("list"), scope: Schema.Literals(["active", "archived"]) }),
  Schema.Struct({ ...base, op: Schema.Literal("projects") }),
  Schema.Struct({ ...base, op: Schema.Literal("conversation"), id: Schema.String }),
  Schema.Struct({ ...base, op: Schema.Literal("detail"), id: Schema.String }),
  Schema.Struct({
    ...base,
    op: Schema.Literal("change"),
    id: Schema.String,
    runId: Schema.String,
    action: MutatingActionSchema,
    body: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    ...base,
    op: Schema.Literal("arm"),
    runId: Schema.String,
    jobs: Schema.Array(Schema.Struct({ id: Schema.String, action: MutatingActionSchema })),
  }),
  Schema.Struct({ ...base, op: Schema.Literal("disarm"), runId: Schema.String }),
]);

export type ApiRequest = Schema.Schema.Type<typeof ApiRequestSchema>;

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

export const SessionSchema = Schema.Struct({ accessToken: Schema.String, userId: NullableString });

export const ChatListSchema = Schema.Array(ChatSchema);
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
  projectId: NullableString,
  title: NullableString,
});

export function decodeValue<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  return Schema.decodeUnknownSync(schema)(value);
}

export const PingRequestSchema = Schema.Literal("chatgpt/ping");

export function isApiRequest(message: unknown): message is ApiRequest {
  try {
    Schema.decodeUnknownSync(ApiRequestSchema, { onExcessProperty: "error" })(message);
    return true;
  } catch {
    return false;
  }
}

export function isPingRequest(message: unknown): message is "chatgpt/ping" {
  return message === "chatgpt/ping";
}

export function decodeApiResponse(message: unknown): ApiResponse | null {
  try {
    return Schema.decodeUnknownSync(ApiResponseSchema)(message);
  } catch {
    return null;
  }
}
