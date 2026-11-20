import { Schema } from "effect";

const BOOKMARK_OPERATIONS = ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"] as const;
const LIKES_OPERATIONS = ["Likes"] as const;
export const PROFILE_OPERATIONS = ["UserTweets", "UserTweetsAndReplies", "UserOriginalsTimeline", "UserRepliesTimeline"] as const;
const LOOKUP_OPERATIONS = ["UserByScreenName"] as const;
const OPERATIONS = [...BOOKMARK_OPERATIONS, ...LIKES_OPERATIONS, ...PROFILE_OPERATIONS, ...LOOKUP_OPERATIONS] as const;
export type Operation = (typeof OPERATIONS)[number];
export type ProfileOperation = (typeof PROFILE_OPERATIONS)[number];

export function isProfileOperation(operation: Operation): operation is ProfileOperation {
  return (PROFILE_OPERATIONS as readonly Operation[]).includes(operation);
}

export const CredentialsSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  clientUuid: Schema.optional(Schema.String),
  transactionId: Schema.optional(Schema.String),
  queryIds: Schema.Record(Schema.String, Schema.String),
  features: Schema.Record(Schema.String, Schema.String),
  fieldToggles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
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

export interface Capture {
  operation: Operation;
  queryId: string;
  authorization?: string;
  clientUuid?: string;
  transactionId?: string;
  features?: string;
  fieldToggles?: string;
  targetUserId?: string;
  variables?: string;
}

export function captureRequest(
  url: string,
  initiator: string | undefined,
  headers: readonly { name: string; value?: string | undefined }[],
): Capture | null {
  if (initiator !== "https://x.com" && initiator !== "https://twitter.com") return null;
  const requestUrl = new URL(url);
  if (requestUrl.origin !== "https://x.com") return null;
  const match = new RegExp(
    "^/i/api/graphql/([A-Za-z0-9_-]+)/(" + OPERATIONS.join("|") + ")$",
    "u",
  ).exec(requestUrl.pathname);
  if (!match) return null;
  const queryId = match[1];
  const operation = match[2] as Operation;
  if (!queryId) return null;
  const values = new Map(headers.map((header) => [header.name.toLowerCase(), header.value]));
  const validatedFeatures = booleanFeatureRecord(requestUrl.searchParams.get("features"));
  const authorization = values.get("authorization");
  const clientUuid = values.get("x-client-uuid");
  const transactionId = values.get("x-client-transaction-id");
  const fieldToggles = booleanFeatureRecord(requestUrl.searchParams.get("fieldToggles"));
  const variables = requestUrl.searchParams.get("variables");
  const targetUserId = isProfileOperation(operation) ? profileTargetFromVariables(requestUrl) : undefined;
  return {
    operation,
    queryId,
    ...(authorization ? { authorization } : {}),
    ...(clientUuid ? { clientUuid } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(validatedFeatures ? { features: validatedFeatures } : {}),
    ...(fieldToggles ? { fieldToggles } : {}),
    ...(targetUserId ? { targetUserId } : {}),
    ...(variables ? { variables: variables.length > 1200 ? variables.slice(0, 1200) + "…" : variables } : {}),
  };
}

function booleanFeatureRecord(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
        Object.values(parsed).every((value) => typeof value === "boolean")) {
      return raw;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function profileTargetFromVariables(requestUrl: URL): string | undefined {
  const raw = requestUrl.searchParams.get("variables");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const userId = parsed["userId"] ?? parsed["user_id"];
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
    fieldToggles: {
      ...credentials.fieldToggles,
      ...(capture.fieldToggles ? { [capture.operation]: capture.fieldToggles } : {}),
    },
  };
}

const RESERVED_X_PATHS = new Set([
  "i", "home", "explore", "search", "notifications", "messages", "bookmarks",
  "compose", "settings", "privacy", "tos", "login", "signup", "premium", "jobs",
  "communities", "lists", "verified-orgs", "about", "download",
]);

const PROFILE_SUBPATHS = new Set([
  "with_replies", "media", "likes", "highlights", "followers", "following", "affiliates",
]);

export function parseProfileScreenName(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== "https://x.com") return null;
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const handle = segments[0]!;
  if (!/^[A-Za-z0-9_]{1,15}$/u.test(handle)) return null;
  if (RESERVED_X_PATHS.has(handle.toLowerCase())) return null;
  if (segments.length === 1) return handle;
  if (segments.length === 2 && PROFILE_SUBPATHS.has(segments[1]!.toLowerCase())) return handle;
  return null;
}


export function profileTargetKey(userId: string): string {
  return "x_profile_target_" + userId;
}

export interface ProfileTarget {
  targetUserId?: string | undefined;
  screenName?: string | undefined;
  operation: ProfileOperation;
  capturedAt: string;
}

const ProfileTargetSchema = Schema.Struct({
  targetUserId: Schema.optional(Schema.String),
  screenName: Schema.optional(Schema.String),
  operation: Schema.Literals(PROFILE_OPERATIONS),
  capturedAt: Schema.String,
});

function hasTargetIdentity(target: ProfileTarget): boolean {
  return target.targetUserId !== undefined || target.screenName !== undefined;
}

export function validateProfileTarget(target: ProfileTarget): ProfileTarget {
  if (!hasTargetIdentity(target)) throw new Error("Profile target requires a user id or a screen name.");
  if (target.screenName !== undefined && !/^[A-Za-z0-9_]{1,15}$/u.test(target.screenName)) {
    throw new Error("Profile target screen name is invalid.");
  }
  return target;
}

export function decodeProfileTarget(value: unknown): ProfileTarget | null {
  try {
    const target = Schema.decodeUnknownSync(ProfileTargetSchema)(value);
    return hasTargetIdentity(target) && (target.targetUserId === undefined || /^\d+$/u.test(target.targetUserId))
      ? target
      : null;
  } catch {
    return null;
  }
}
