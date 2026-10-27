import { Schema } from "effect";

export const ResourceReferenceSchema = Schema.Struct({
  url: Schema.String,
  kind: Schema.Literals(["image", "stylesheet", "font"]),
});

export const UnresolvedResourceSchema = Schema.Struct({
  url: Schema.String,
  reason: Schema.String,
});

export const CapturePayloadSchema = Schema.Struct({
  pageUrl: Schema.String,
  title: Schema.String,
  capturedAtMs: Schema.Number,
  pageHtml: Schema.String,
  resources: Schema.Array(ResourceReferenceSchema),
  unresolved: Schema.Array(UnresolvedResourceSchema),
});

export type CapturePayload = Schema.Schema.Type<typeof CapturePayloadSchema>;

