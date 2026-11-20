import { Effect, Schema } from "effect";
import { type Credentials, type Operation } from "./capture.ts";
import { type XSessionProvider } from "./session.ts";

function graphqlErrorMessage(errors: unknown[]): string | null {
  const messages = errors.flatMap((error) => {
    if (error === null || typeof error !== "object") return [];
    const message = (error as Record<string, unknown>)["message"];
    return typeof message === "string" ? [message] : [];
  });
  return messages.length > 0 ? messages.join("; ").slice(0, 500) : null;
}

async function readGraphqlError(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== "object") return null;
    const errors = (body as Record<string, unknown>)["errors"];
    return Array.isArray(errors) ? graphqlErrorMessage(errors) : null;
  } catch {
    return null;
  }
}

const FailureKindSchema = Schema.Literals(["auth", "rate_limit", "query", "network", "response", "stopped"]);

const DEFAULT_FIELD_TOGGLES = '{"withPayments":false,"withArticlePlainText":false}';
const GRAPHQL_FIELD_TOGGLES = ["UserOriginalsTimeline", "UserRepliesTimeline", "UserByScreenName", "UserByRestId"] as const;

type FailureKind = Schema.Schema.Type<typeof FailureKindSchema>;

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
  capturedFieldToggles?: string,
): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(queryId)) throw new RequestFailure("query", "Invalid captured X query ID.");
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: capturedFeatures ?? "{}",
  });
  if (capturedFieldToggles) params.set("fieldToggles", capturedFieldToggles);
  return "https://x.com/i/api/graphql/" + queryId + "/" + operation + "?" + params.toString();
}

export function graphqlRequest(
  userId: string,
  credentials: Credentials,
  operation: Operation,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  session: XSessionProvider,
): Effect.Effect<unknown, RequestFailure> {
  return Effect.tryPromise({
    try: async (): Promise<unknown> => {
      if (signal.aborted) throw new RequestFailure("stopped", "Stopped by user.");
      const current = await session();
      if (!current.userId || current.userId !== userId) {
        throw new RequestFailure("auth", "X account changed or session expired. No data was saved.");
      }
      const authorization = credentials.authorization;
      const queryId = credentials.queryIds[operation];
      if (!authorization || !queryId) {
        throw new RequestFailure("auth", "Open X and reload it to capture fresh API credentials.");
      }
      if (!current.csrfToken) throw new RequestFailure("auth", "Missing X CSRF cookie. Sign in to X again.");
      const headers: Record<string, string> = {
        Authorization: authorization,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
        Origin: "https://x.com",
        Referer: "https://x.com/",
        "X-Csrf-Token": current.csrfToken,
        ...(current.cookieHeader ? { Cookie: current.cookieHeader } : {}),
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Client-Language": "en",
      };
      if (credentials.clientUuid) headers["X-Client-Uuid"] = credentials.clientUuid;
      if (credentials.transactionId) headers["X-Client-Transaction-Id"] = credentials.transactionId;

      const url = buildGraphqlUrl(
        queryId,
        operation,
        variables,
        credentials.features[operation],
        credentials.fieldToggles?.[operation]
          ?? (((GRAPHQL_FIELD_TOGGLES as readonly string[]).includes(operation)) ? DEFAULT_FIELD_TOGGLES : undefined),
      );
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

      if (process.env["X_ARCHIVE_DEBUG"]) {
        const names = Object.keys(headers).map((name) => name + "=" + String(headers[name]).length).join(",");
        console.error("x-debug: operation=" + operation + " status=" + response.status + " header-lengths=" + names + " url=" + url);
      }
      if (response.status === 429) throw new RequestFailure("rate_limit", "X rate limit reached (HTTP 429).");
      if (response.status === 401 || response.status === 403) {
        throw new RequestFailure("auth", "X rejected the session (HTTP " + response.status + "). Revisit X and try again.");
      }
      if ([400, 404, 422].includes(response.status)) {
        const graphqlMessage = await readGraphqlError(response);
        throw new RequestFailure("query",
          "X rejected the captured query (HTTP " + response.status + ")"
          + (graphqlMessage ? ": " + graphqlMessage : "") + ".");
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
        const message = graphqlErrorMessage(body["errors"]);
        throw new RequestFailure(rateLimited ? "rate_limit" : "query",
          rateLimited
            ? "X GraphQL rate limit reached."
            : "X GraphQL returned an error" + (message ? ": " + message : "; the private API may have changed."));
      }
      if ((await session()).userId !== userId) {
        throw new RequestFailure("auth", "X account switched during the request. The response was discarded.");
      }
      return data;
    },
    catch: (cause) => cause instanceof RequestFailure
      ? cause
      : new RequestFailure("network", String(cause)),
  });
}
