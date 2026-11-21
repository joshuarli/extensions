export type FailureKind =
  | "aborted"
  | "offline"
  | "auth"
  | "cooldown"
  | "ratelimit"
  | "transient"
  | "notfound"
  | "http"
  | "compat";

export class TriageError extends Error {
  readonly kind: FailureKind;
  readonly until: number;

  constructor(kind: FailureKind, message: string, until = 0) {
    super(message);
    this.name = "TriageError";
    this.kind = kind;
    this.until = until;
  }
}

export function isTriageError(value: unknown): value is TriageError {
  return value instanceof TriageError;
}

export function failureOf(value: unknown): TriageError {
  if (isTriageError(value)) return value;
  return new TriageError("http", value instanceof Error ? value.message : String(value));
}
