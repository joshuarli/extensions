import { Schema } from "effect";

export const BOOKMARK_OPERATIONS = ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"] as const;
export const PROFILE_OPERATIONS = ["UserTweets", "UserTweetsAndReplies"] as const;
export const OPERATIONS = [...BOOKMARK_OPERATIONS, ...PROFILE_OPERATIONS] as const;
export type Operation = (typeof OPERATIONS)[number];
export type ProfileOperation = (typeof PROFILE_OPERATIONS)[number];

export function isProfileOperation(operation: Operation): operation is ProfileOperation {
  return (PROFILE_OPERATIONS as readonly Operation[]).includes(operation);
}

const CredentialsSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  clientUuid: Schema.optional(Schema.String),
  transactionId: Schema.optional(Schema.String),
  queryIds: Schema.Record(Schema.String, Schema.String),
  features: Schema.Record(Schema.String, Schema.String),
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
  targetUserId?: string;
}

export interface CaptureOptions {
  profileCaptureArmed?: boolean;
}

export function captureRequest(
  url: string,
  initiator: string | undefined,
  headers: readonly { name: string; value?: string | undefined }[],
  options: CaptureOptions = {},
): Capture | null {
  if (initiator !== "https://x.com" && initiator !== "https://twitter.com") return null;
  const requestUrl = new URL(url);
  if (requestUrl.origin !== "https://x.com") return null;
  const bookmarkMatch = /^\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/(Bookmarks|BookmarkFoldersSlice|BookmarkFolderTimeline)$/u.exec(requestUrl.pathname);
  const profileMatch = options.profileCaptureArmed === true
    ? /^\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/(UserTweets|UserTweetsAndReplies)$/u.exec(requestUrl.pathname)
    : null;
  const match = bookmarkMatch ?? profileMatch;
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
  const authorization = values.get("authorization");
  const clientUuid = values.get("x-client-uuid");
  const transactionId = values.get("x-client-transaction-id");
  const targetUserId = isProfileOperation(operation) ? profileTargetFromVariables(requestUrl) : undefined;
  return {
    operation,
    queryId,
    ...(authorization ? { authorization } : {}),
    ...(clientUuid ? { clientUuid } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(validatedFeatures ? { features: validatedFeatures } : {}),
    ...(targetUserId ? { targetUserId } : {}),
  };
}

function profileTargetFromVariables(requestUrl: URL): string | undefined {
  const raw = requestUrl.searchParams.get("variables");
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const userId = (parsed as Record<string, unknown>)["userId"];
    if (typeof userId !== "string" && typeof userId !== "number") return undefined;
    const digits = String(userId);
    return /^\d+$/u.test(digits) ? digits : undefined;
  } catch {
    return undefined;
  }
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

export function profileArmedKey(userId: string): string {
  return "x_profile_armed_" + userId;
}

export function profileTargetKey(userId: string): string {
  return "x_profile_target_" + userId;
}

export interface ProfileTarget {
  targetUserId: string;
  operation: ProfileOperation;
  capturedAt: string;
}

const ProfileTargetSchema = Schema.Struct({
  targetUserId: Schema.String,
  operation: Schema.Literals(PROFILE_OPERATIONS),
  capturedAt: Schema.String,
});

export async function readProfileCaptureArmed(userId: string): Promise<boolean> {
  const key = profileArmedKey(userId);
  return (await chrome.storage.local.get(key))[key] === true;
}

export async function writeProfileCaptureArmed(userId: string, armed: boolean): Promise<void> {
  await chrome.storage.local.set({ [profileArmedKey(userId)]: armed });
}

export async function readProfileTarget(userId: string): Promise<ProfileTarget | null> {
  const key = profileTargetKey(userId);
  try {
    return Schema.decodeUnknownSync(ProfileTargetSchema)((await chrome.storage.local.get(key))[key]);
  } catch {
    return null;
  }
}

export async function writeProfileTarget(userId: string, target: ProfileTarget): Promise<void> {
  await chrome.storage.local.set({
    [profileTargetKey(userId)]: Schema.decodeUnknownSync(ProfileTargetSchema)(target),
  });
}
