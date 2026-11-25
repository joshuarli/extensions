import { Schema } from "effect";

const FailureKindSchema = Schema.Literals(["auth", "rate_limit", "transport", "shape", "stopped"]);

export type ChatgptFailureKind = Schema.Schema.Type<typeof FailureKindSchema>;

export class ChatgptRequestFailure extends Schema.TaggedError<ChatgptRequestFailure>()("ChatgptRequestFailure", {
  kind: FailureKindSchema,
  message: Schema.String,
}) {
  constructor(kind: ChatgptFailureKind, message: string) {
    super({ kind, message });
  }
}
