import { Schema } from "effect";

export const ValueKindSchema = Schema.Literals([
  "caller_input",
  "response_dependency",
  "captured_config",
  "session_material",
  "app_generated",
]);
export type ValueKind = Schema.Schema.Type<typeof ValueKindSchema>;

export const OperationRecipeSchema = Schema.Struct({
  operation: Schema.String,
  semantic_name: Schema.String,
  description: Schema.String,
  method: Schema.Literals(["GET", "POST"]),
  path: Schema.String,
  caller_inputs: Schema.Array(Schema.String),
  response_dependencies: Schema.Array(Schema.String),
  captured_config: Schema.Array(Schema.String),
  session_material: Schema.Array(Schema.String),
  app_generated: Schema.Array(Schema.String),
  observation_recipe: Schema.Array(Schema.String),
  verification_cases: Schema.Array(Schema.String),
  fixtures: Schema.Array(Schema.String),
});
export type OperationRecipe = Schema.Schema.Type<typeof OperationRecipeSchema>;

export interface Observation {
  label: string;
  method: string;
  path: string;
  values: Record<string, unknown>;
  responseKeys: string[];
  headers: Record<string, string>;
}

const CALLER_INPUTS = new Set(["userId", "screenName", "feed", "count", "lang"]);
const CAPTURED_CONFIG = new Set(["features", "fieldToggles"]);
const SESSION_HEADERS = new Set(["authorization", "x-csrf-token", "cookie", "x-client-transaction-id"]);
const SIGNED = /(?:^|_)(?:ts|timestamp|sig|signature|hmac|nonce)$/iu;

function isSigned(key: string, value: unknown): boolean {
  if (!SIGNED.test(key)) return false;
  if (typeof value !== "string") return false;
  return /^\d{10,13}$/u.test(value) || /^[A-Fa-f0-9]{16,}$/u.test(value);
}

export function deriveRecipe(
  operation: string,
  semanticName: string,
  observations: readonly Observation[],
): OperationRecipe {
  if (observations.length === 0) throw new Error("A recipe needs at least one observation.");
  const first = observations[0]!;
  const keys = [...new Set(observations.flatMap((entry) => Object.keys(entry.values)))].sort();
  const kinds: Record<"caller_inputs" | "response_dependencies" | "captured_config" | "session_material" | "app_generated", string[]> = {
    caller_inputs: [],
    response_dependencies: [],
    captured_config: [],
    session_material: [],
    app_generated: [],
  };
  for (const key of keys) {
    const values = observations.map((entry) => entry.values[key]);
    const distinct = new Set(values.map((value) => JSON.stringify(value)));
    if (isSigned(key, values[0])) kinds.app_generated.push(key);
    else if (CAPTURED_CONFIG.has(key)) kinds.captured_config.push(key);
    else if (key === "cursor" || observations.some((entry) => entry.responseKeys.includes(String(values[0])))) {
      kinds.response_dependencies.push(key);
    } else if (CALLER_INPUTS.has(key)) kinds.caller_inputs.push(key);
    else if (distinct.size > 1) kinds.app_generated.push(key);
    else kinds.captured_config.push(key);
  }
  const headers = [...new Set(observations.flatMap((entry) => Object.keys(entry.headers)))].filter((name) =>
    SESSION_HEADERS.has(name.toLowerCase()));
  kinds.session_material.push(...headers.map((name) => name.toLowerCase()).sort());
  return {
    operation,
    semantic_name: semanticName,
    description: "Request recipe derived from " + observations.length + " browser observations. "
      + "Caller inputs are explicit; continuation values come from the previous response; "
      + "captured configuration is refreshed by observing the page; session material comes from the live browser.",
    method: first.method.toUpperCase() === "POST" ? "POST" : "GET",
    path: first.path,
    ...kinds,
    observation_recipe: observations.map((entry) => entry.label),
    verification_cases: [
      "identity: returned tweet ids match the response observed in the browser",
      "attribution: author id and handle come from the tweet's user result",
      "links: expanded URL entities are preserved",
      "continuation: a second page uses a cursor from the first response",
      "auth failure: a 401 or 403 stops the run without saving an empty page",
      "rate limit: a 429 is retried with backoff",
      "unknown shape: a post-bearing module fails the page instead of dropping posts",
    ],
    fixtures: [],
  };
}
