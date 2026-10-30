import { Schema } from "effect";

export const OPERATIONS = ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"] as const;
export type Operation = (typeof OPERATIONS)[number];

const CredentialsSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  clientUuid: Schema.optional(Schema.String),
  transactionId: Schema.optional(Schema.String),
  queryIds: Schema.Record({ key: Schema.String, value: Schema.String }),
  features: Schema.Record({ key: Schema.String, value: Schema.String }),
});

export type Credentials = Schema.Schema.Type<typeof CredentialsSchema>;

export function credentialKey(userId: string): string {
  return "x_bookmarks_credentials_" + userId;
}

export function parseUserId(value: string | undefined): string | null {
  try {
    return /^u=(\d+)$/u.exec(decodeURIComponent(value ?? "").replaceAll('"', ""))?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function currentUserId(): Promise<string | null> {
  const cookie = await chrome.cookies.get({ url: "https://x.com/", name: "twid" });
  return parseUserId(cookie?.value);
}

export async function readCredentials(userId: string): Promise<Credentials> {
  const key = credentialKey(userId);
  const stored = (await chrome.storage.local.get(key))[key];
  try {
    return Schema.decodeUnknownSync(CredentialsSchema)(stored);
  } catch {
    return { queryIds: {}, features: {} };
  }
}

export interface Capture {
  operation: Operation;
  queryId: string;
  authorization?: string;
  clientUuid?: string;
  transactionId?: string;
  features?: string;
}

export function captureRequest(
  url: string,
  initiator: string | undefined,
  headers: readonly { name: string; value?: string }[],
): Capture | null {
  if (initiator !== "https://x.com" && initiator !== "https://twitter.com") return null;
  const requestUrl = new URL(url);
  if (requestUrl.origin !== "https://x.com") return null;
  const match = /^\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/(Bookmarks|BookmarkFoldersSlice|BookmarkFolderTimeline)$/u.exec(requestUrl.pathname);
  if (!match) return null;
  const queryId = match[1];
  const operation = match[2] as Operation;
  if (!queryId) return null;
  const values = new Map(headers.map((header) => [header.name.toLowerCase(), header.value]));
  const features = requestUrl.searchParams.get("features") ?? undefined;
  let validatedFeatures: string | undefined;
  if (features) {
    try {
      const parsed: unknown = JSON.parse(features);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          Object.values(parsed).every((value) => typeof value === "boolean")) {
        validatedFeatures = features;
      }
    } catch { /* Ignore invalid feature flags. */ }
  }
  return {
    operation,
    queryId,
    ...(values.get("authorization") ? { authorization: values.get("authorization") } : {}),
    ...(values.get("x-client-uuid") ? { clientUuid: values.get("x-client-uuid") } : {}),
    ...(values.get("x-client-transaction-id") ? { transactionId: values.get("x-client-transaction-id") } : {}),
    ...(validatedFeatures ? { features: validatedFeatures } : {}),
  };
}

export function mergeCapture(credentials: Credentials, capture: Capture): Credentials {
  return {
    ...credentials,
    ...(capture.authorization ? { authorization: capture.authorization } : {}),
    ...(capture.clientUuid ? { clientUuid: capture.clientUuid } : {}),
    ...(capture.transactionId ? { transactionId: capture.transactionId } : {}),
    queryIds: { ...credentials.queryIds, [capture.operation]: capture.queryId },
    features: {
      ...credentials.features,
      ...(capture.features ? { [capture.operation]: capture.features } : {}),
    },
  };
}
