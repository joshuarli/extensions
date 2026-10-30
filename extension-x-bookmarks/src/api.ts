import { Effect, Schema } from "effect";
import { currentUserId, type Credentials, type Operation } from "./capture.ts";

const FailureKindSchema = Schema.Literals(["auth", "rate_limit", "query", "network", "response", "stopped"]);

export type FailureKind = Schema.Schema.Type<typeof FailureKindSchema>;

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("RequestFailure", {
  kind: FailureKindSchema,
  message: Schema.String,
}) {
  constructor(kind: FailureKind, message: string) {
    super({ kind, message });
  }
}

export function buildGraphqlUrl(
  queryId: string,
  operation: Operation,
  variables: Record<string, unknown>,
  capturedFeatures: string | undefined,
): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(queryId)) throw new RequestFailure("query", "Invalid captured X query ID.");
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: capturedFeatures ?? "{}",
  });
  return "https://x.com/i/api/graphql/" + queryId + "/" + operation + "?" + params.toString();
}

export function graphqlRequest(
  userId: string,
  credentials: Credentials,
  operation: Operation,
  variables: Record<string, unknown>,
  signal: AbortSignal,
): Effect.Effect<unknown, RequestFailure> {
  return Effect.tryPromise({
    try: async (): Promise<unknown> => {
      if (signal.aborted) throw new RequestFailure("stopped", "Stopped by user.");
      const session = await currentUserId();
      if (!session || session !== userId) {
        throw new RequestFailure("auth", "X account changed or session expired. No data was saved.");
      }
      const authorization = credentials.authorization;
      const queryId = credentials.queryIds[operation];
      if (!authorization || !queryId) {
        throw new RequestFailure("auth", "Open X bookmarks and reload the extension page to capture fresh API credentials.");
      }
      const csrf = await chrome.cookies.get({ url: "https://x.com/", name: "ct0" });
      if (!csrf?.value) throw new RequestFailure("auth", "Missing X CSRF cookie. Sign in to X again.");
      const headers: Record<string, string> = {
        Authorization: authorization,
        "X-Csrf-Token": csrf.value,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Client-Language": "en",
      };
      if (credentials.clientUuid) headers["X-Client-Uuid"] = credentials.clientUuid;
      if (credentials.transactionId) headers["X-Client-Transaction-Id"] = credentials.transactionId;

      const url = buildGraphqlUrl(queryId, operation, variables, credentials.features[operation]);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers,
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
      } catch (cause) {
        if (signal.aborted) throw new RequestFailure("stopped", "Stopped by user.");
        throw new RequestFailure("network", "X request failed: " + String(cause));
      }

      if (response.status === 429) throw new RequestFailure("rate_limit", "X rate limit reached (HTTP 429).");
      if (response.status === 401 || response.status === 403) {
        throw new RequestFailure("auth", "X rejected the session (HTTP " + response.status + "). Revisit X bookmarks.");
      }
      if ([400, 404, 422].includes(response.status)) {
        throw new RequestFailure("query", "X rejected the captured query (HTTP " + response.status + "). Revisit X bookmarks.");
      }
      if (!response.ok) throw new RequestFailure("network", "X returned HTTP " + response.status + ".");
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new RequestFailure("response", "X returned invalid JSON.");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new RequestFailure("response", "X returned an unexpected response.");
      }
      const body = data as Record<string, unknown>;
      if (Array.isArray(body["errors"]) && body["errors"].length > 0) {
        const rateLimited = body["errors"].some((error: unknown) =>
          error !== null && typeof error === "object" && (error as Record<string, unknown>)["code"] === 88);
        throw new RequestFailure(rateLimited ? "rate_limit" : "query",
          rateLimited ? "X GraphQL rate limit reached." : "X GraphQL returned an error; the private API may have changed.");
      }
      if (await currentUserId() !== userId) {
        throw new RequestFailure("auth", "X account switched during the request. The response was discarded.");
      }
      return data;
    },
    catch: (cause) => cause instanceof RequestFailure
      ? cause
      : new RequestFailure("network", String(cause)),
  });
}
