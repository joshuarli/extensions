import { Schema } from "effect";

export const ExtensionMessageSchema = Schema.Struct({
    action: Schema.Literals([
      "copyTranscript",
      "copySrt",
      "getTranscript",
      "getSubtitle",
      "downloadFixtures",
    ]),
    tabId: Schema.optional(Schema.Number),
  }),
  ExtensionResponseSchema = Schema.Union([
    Schema.Struct({ label: Schema.String }),
    Schema.Struct({ transcript: Schema.String }),
    Schema.Struct({
      error: Schema.String,
      errorDetail: Schema.optional(Schema.String),
    }),
  ]);

export type ExtensionMessage = Schema.Schema.Type<typeof ExtensionMessageSchema>;
export type ExtensionResponse = Schema.Schema.Type<typeof ExtensionResponseSchema>;
