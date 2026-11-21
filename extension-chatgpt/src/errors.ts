export const FAILURE_KINDS = [
  "aborted",
  "offline",
  "auth",
  "cooldown",
  "ratelimit",
  "transient",
  "notfound",
  "http",
  "compat",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

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

export function isFailureKind(value: string): value is FailureKind {
  return (FAILURE_KINDS as readonly string[]).includes(value);
}

export function failureOf(value: unknown): TriageError {
  if (value instanceof TriageError) return value;
  return new TriageError("http", value instanceof Error ? value.message : String(value));
}

// A transport failure or server error does not prove that a write was not applied.
export function mayHaveApplied(error: TriageError): boolean {
  return error.kind === "transient" || error.kind === "offline";
}
