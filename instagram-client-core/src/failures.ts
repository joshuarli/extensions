import { Schema } from "effect";

const FailureKindSchema = Schema.Literals([
  "auth",
  "rate_limit",
  "checkpoint",
  "warning",
  "unrecognized",
  "transport",
  "shape",
  "stopped",
]);

export type InstagramFailureKind = Schema.Schema.Type<typeof FailureKindSchema>;

export class InstagramRequestFailure extends Schema.TaggedError<InstagramRequestFailure>()("InstagramRequestFailure", {
  kind: FailureKindSchema,
  message: Schema.String,
  operation: Schema.String,
}) {
  constructor(kind: InstagramFailureKind, message: string, operation: string) {
    super({ kind, message, operation });
  }
}

const PARKING_KINDS: readonly InstagramFailureKind[] = ["auth", "rate_limit", "checkpoint", "warning", "unrecognized"];

export function parksJob(failure: InstagramRequestFailure): boolean {
  return PARKING_KINDS.includes(failure.kind);
}
