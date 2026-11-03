import { Schema } from "effect";

export const SuiteRequestSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("allow-right-click/toggle"), tabId: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("allow-right-click/status"), tabId: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("onefile/save"), tabId: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("x-bookmarks/open-exporter") }),
]);

export type SuiteRequest = Schema.Schema.Type<typeof SuiteRequestSchema>;

export const SuiteResponseSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String) }),
  Schema.Struct({ status: Schema.Literals(["on", "off", ""]) }),
]);

export type SuiteResponse = Schema.Schema.Type<typeof SuiteResponseSchema>;

export function isSuiteRequest(message: unknown): message is SuiteRequest {
  try {
    Schema.decodeUnknownSync(SuiteRequestSchema, { onExcessProperty: "error" })(message);
    return true;
  } catch {
    return false;
  }
}
