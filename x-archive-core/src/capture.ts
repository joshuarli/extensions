import { Schema } from "effect";

const HOME_OPERATIONS = ["HomeTimeline", "HomeLatestTimeline"] as const;
export const SOCIAL_OPERATIONS = ["Following", "Followers"] as const;
const BOOKMARK_OPERATIONS = ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"] as const;
const LIKES_OPERATIONS = ["Likes"] as const;
export const PROFILE_OPERATIONS = ["UserTweets", "UserTweetsAndReplies", "UserOriginalsTimeline", "UserRepliesTimeline"] as const;
const LOOKUP_OPERATIONS = ["UserByScreenName"] as const;
const OPERATIONS = [...HOME_OPERATIONS, ...SOCIAL_OPERATIONS, ...BOOKMARK_OPERATIONS, ...LIKES_OPERATIONS, ...PROFILE_OPERATIONS, ...LOOKUP_OPERATIONS] as const;
export type Operation = (typeof OPERATIONS)[number];
export type ProfileOperation = (typeof PROFILE_OPERATIONS)[number];
export type SocialOperation = (typeof SOCIAL_OPERATIONS)[number];

export function isProfileOperation(operation: Operation): operation is ProfileOperation {
  return (PROFILE_OPERATIONS as readonly Operation[]).includes(operation);
}

export function isSocialOperation(operation: Operation): operation is SocialOperation {
  return (SOCIAL_OPERATIONS as readonly Operation[]).includes(operation);
}

export const CredentialsSchema = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  clientUuid: Schema.optional(Schema.String),
  transactionId: Schema.optional(Schema.String),
  queryIds: Schema.Record(Schema.String, Schema.String),
  features: Schema.Record(Schema.String, Schema.String),
  fieldToggles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  methods: Schema.optional(Schema.Record(Schema.String, Schema.Literals(["GET", "POST"]))),
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

export type CapturedMethod = "GET" | "POST";

export interface Capture {
  operation: Operation;
  queryId: string;
  method?: CapturedMethod;
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
  method: string = "GET",
  body?: string | undefined,
): Capture | null {
  if (initiator !== "https://x.com" && initiator !== "https://twitter.com") return null;
  if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "POST") return null;
  const capturedMethod = method.toUpperCase() as CapturedMethod;
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
  const bodyValues = capturedMethod === "POST" ? jsonBody(body) : null;
  const values = new Map(headers.map((header) => [header.name.toLowerCase(), header.value]));
  const validatedFeatures = booleanFeatureRecord(requestUrl.searchParams.get("features"))
    ?? (bodyValues ? booleanFeatureRecord(bodyValues["features"]) : undefined);
  const authorization = values.get("authorization");
  const clientUuid = values.get("x-client-uuid");
  const transactionId = values.get("x-client-transaction-id");
  const fieldToggles = booleanFeatureRecord(requestUrl.searchParams.get("fieldToggles"))
    ?? (bodyValues ? booleanFeatureRecord(bodyValues["fieldToggles"]) : undefined);
  const rawVariables = requestUrl.searchParams.get("variables")
    ?? (bodyValues ? stringifyVariables(bodyValues["variables"]) : null);
  const targetUserId = isProfileOperation(operation) || isSocialOperation(operation)
    ? profileTargetFromVariables(requestUrl) ?? profileTargetFromBody(bodyValues)
    : undefined;
  return {
    operation,
    queryId,
    method: capturedMethod,
    ...(authorization ? { authorization } : {}),
    ...(clientUuid ? { clientUuid } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(validatedFeatures ? { features: validatedFeatures } : {}),
    ...(fieldToggles ? { fieldToggles } : {}),
    ...(targetUserId ? { targetUserId } : {}),
    ...(rawVariables ? { variables: rawVariables.length > 1200 ? rawVariables.slice(0, 1200) + "…" : rawVariables } : {}),
  };
}

function jsonBody(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringifyVariables(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function booleanFeatureRecord(raw: unknown): string | undefined {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (!Object.values(parsed).every((value) => typeof value === "boolean")) return undefined;
  return JSON.stringify(parsed);
}

function profileTargetFromBody(body: Record<string, unknown> | null): string | undefined {
  const variables = body?.["variables"];
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) return undefined;
  const userId = (variables as Record<string, unknown>)["userId"]
    ?? (variables as Record<string, unknown>)["user_id"];
  if (typeof userId !== "string" && typeof userId !== "number") return undefined;
  const digits = String(userId);
  return /^\d+$/u.test(digits) ? digits : undefined;
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

export function mergeCredentials(base: Credentials, next: Credentials): Credentials {
  return {
    ...(base.authorization ?? next.authorization
      ? { authorization: next.authorization ?? base.authorization } : {}),
    ...(base.clientUuid ?? next.clientUuid ? { clientUuid: next.clientUuid ?? base.clientUuid } : {}),
    ...(base.transactionId ?? next.transactionId ? { transactionId: next.transactionId ?? base.transactionId } : {}),
    ...(base.methods || next.methods ? { methods: { ...base.methods, ...next.methods } } : {}),
    queryIds: { ...base.queryIds, ...next.queryIds },
    features: { ...base.features, ...next.features },
    ...(base.fieldToggles || next.fieldToggles
      ? { fieldToggles: { ...base.fieldToggles, ...next.fieldToggles } } : {}),
  };
}

export function mergeCapture(credentials: Credentials, capture: Capture): Credentials {
  return mergeCredentials(credentials, {
    ...(capture.authorization ? { authorization: capture.authorization } : {}),
    ...(capture.clientUuid ? { clientUuid: capture.clientUuid } : {}),
    ...(capture.transactionId ? { transactionId: capture.transactionId } : {}),
    ...(capture.method ? { methods: { [capture.operation]: capture.method } } : {}),
    queryIds: { [capture.operation]: capture.queryId },
    features: capture.features ? { [capture.operation]: capture.features } : {},
    ...(capture.fieldToggles ? { fieldToggles: { [capture.operation]: capture.fieldToggles } } : {}),
  });
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
