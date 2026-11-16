import { Effect } from "effect";

import {
  graphqlRequest as coreGraphqlRequest,
  RequestFailure,
} from "../../x-archive-core/src/api.ts";
import { parseUserId, type Credentials, type Operation } from "../../x-archive-core/src/capture.ts";
import type { XSessionProvider } from "../../x-archive-core/src/session.ts";

export { buildGraphqlUrl, DEFAULT_FIELD_TOGGLES, RequestFailure } from "../../x-archive-core/src/api.ts";
export type { FailureKind } from "../../x-archive-core/src/api.ts";
export type { XSession, XSessionProvider } from "../../x-archive-core/src/session.ts";

const chromeSession: XSessionProvider = async () => {
  const twid = await chrome.cookies.get({ url: "https://x.com/", name: "twid" });
  const ct0 = await chrome.cookies.get({ url: "https://x.com/", name: "ct0" });
  return { userId: parseUserId(twid?.value), csrfToken: ct0?.value ?? null };
};

export { chromeSession };

export function graphqlRequest(
  userId: string,
  credentials: Credentials,
  operation: Operation,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  session: XSessionProvider = chromeSession,
): Effect.Effect<unknown, RequestFailure> {
  return coreGraphqlRequest(userId, credentials, operation, variables, signal, session);
}

export type { Credentials };
