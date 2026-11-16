import { Effect } from "effect";
import { graphqlRequest, RequestFailure } from "./api.ts";
import {
  currentUserId,
  readCredentials,
  readProfileTarget,
  writeProfileTarget,
  type Operation,
  type ProfileOperation,
} from "./capture.ts";
import { parseTimeline, parseFolders, parseProfileTimeline, type Folder } from "./parser.ts";
import { savePage, saveFolders, saveState, type ScanState } from "./storage.ts";
import { saveProfilePage, saveProfileState, type ProfileScanProfile, type ProfileScanState } from "./profile-storage.ts";

const PAGE_DELAY_MS = 2500;
const MAX_EMPTY_PAGES = 3;

function stopped(signal: AbortSignal): void {
  if (signal.aborted) throw new RequestFailure("stopped", "Stopped by user.");
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RequestFailure("stopped", "Stopped by user."));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestFailure("stopped", "Stopped by user."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestWithRetry(
  userId: string,
  operation: Operation,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  report: (message: string) => void,
): Promise<unknown> {
  let consecutiveLimits = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    stopped(signal);
    const credentials = await readCredentials(userId);
    const outcome = await Effect.runPromise(graphqlRequest(userId, credentials, operation, variables, signal).pipe(
      Effect.map((data) => ({ ok: true as const, data })),
      Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
    ));
    if (outcome.ok) return outcome.data;
    const failure = outcome.error;
    if (failure.kind === "stopped" || failure.kind === "auth" || failure.kind === "query" ||
        failure.kind === "response") throw failure;
    if (failure.kind === "rate_limit") {
      consecutiveLimits++;
      if (consecutiveLimits >= 5) throw new RequestFailure("rate_limit", "Too many consecutive X rate limits.");
    } else {
      consecutiveLimits = 0;
    }
    if (attempt === 4) throw failure;
    const wait = consecutiveLimits >= 3
      ? 300_000
      : PAGE_DELAY_MS * (2 ** (attempt + 1)) + Math.random() * 1000;
    report("X request paused after " + failure.kind + "; retrying in " + Math.ceil(wait / 1000) + "s.");
    await delay(wait, signal);
  }
  throw new RequestFailure("network", "Request retries exhausted.");
}

export interface ProgressSnapshot {
  posts: number;
  pages: number;
}

export interface CollectionOptions {
  userId: string;
  db: IDBDatabase;
  signal: AbortSignal;
  report: (message: string) => void;
  onProgress?: (snapshot: ProgressSnapshot) => void;
  progressBase?: { posts: number; pages: number };
}

interface PageSpec<Item> {
  operation: Operation;
  buildVariables(cursor: string | null): Record<string, unknown>;
  parse(data: unknown, observedAt: string): { valid: boolean; items: Item[]; nextCursor: string | null; detail?: string };
  save(items: Item[]): Promise<void>;
  label: string;
  invalidMessage: string;
}

async function scanPages<Item>(options: CollectionOptions, spec: PageSpec<Item>): Promise<number> {
  const { userId, signal, report } = options;
  const visited = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let total = 0;
  let empty = 0;
  while (true) {
    stopped(signal);
    const variables = spec.buildVariables(cursor);
    const response = await requestWithRetry(userId, spec.operation, variables, signal, report);
    stopped(signal);
    if (await currentUserId() !== userId) throw new RequestFailure("auth", "X account changed before saving the page.");
    const result = spec.parse(response, new Date().toISOString());
    if (!result.valid) throw new Error(spec.invalidMessage + (result.detail ? " Details: " + result.detail : ""));
    pages++;
    if (result.items.length) {
      await spec.save(result.items);
      total += result.items.length;
      empty = 0;
    } else {
      empty++;
    }
    report(spec.label + ": " + total + " posts across " + pages + " pages saved.");
    options.onProgress?.({
      posts: total + (options.progressBase?.posts ?? 0),
      pages: pages + (options.progressBase?.pages ?? 0),
    });
    const next = result.nextCursor;
    if (!next) return total;
    if (visited.has(next) || next === cursor) throw new Error("X returned a repeated cursor. Collection is partial.");
    if (empty >= MAX_EMPTY_PAGES) throw new Error("X returned three empty pages. Collection is partial.");
    visited.add(next);
    cursor = next;
    await delay(PAGE_DELAY_MS + Math.random() * 1250, signal);
  }
}

export async function collectTimeline(
  options: CollectionOptions,
  operation: "Bookmarks" | "BookmarkFolderTimeline",
  folderId?: string,
): Promise<number> {
  return scanPages(options, {
    operation,
    buildVariables: (cursor) => {
      const variables: Record<string, unknown> = operation === "Bookmarks"
        ? { count: 100 }
        : { bookmark_collection_id: folderId, count: 50, includePromotedContent: false };
      if (cursor) variables["cursor"] = cursor;
      return variables;
    },
    parse: (data, observedAt) => {
      const result = parseTimeline(data, observedAt);
      return { valid: result.valid, items: result.bookmarks, nextCursor: result.nextCursor, ...(result.detail ? { detail: result.detail } : {}) };
    },
    save: (items) => savePage(options.db, items, folderId),
    label: operation,
    invalidMessage: "X changed its timeline response. Partial results were preserved.",
  });
}

async function collectFolderList(options: CollectionOptions): Promise<Folder[]> {
  const { userId, db, signal, report } = options;
  const folders = new Map<string, Folder>();
  const visited = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    stopped(signal);
    const variables: Record<string, unknown> = cursor ? { cursor } : {};
    const response = await requestWithRetry(userId, "BookmarkFoldersSlice", variables, signal, report);
    stopped(signal);
    if (await currentUserId() !== userId) throw new RequestFailure("auth", "X account changed before saving folders.");
    const result = parseFolders(response);
    if (!result.valid) throw new Error("X changed its bookmark folders response. Folder coverage is partial.");
    await saveFolders(db, result.folders);
    for (const folder of result.folders) folders.set(folder.id, folder);
    if (!result.nextCursor) return [...folders.values()];
    if (visited.has(result.nextCursor) || result.nextCursor === cursor) {
      throw new Error("X returned a repeated folder cursor. Folder coverage is partial.");
    }
    visited.add(result.nextCursor);
    cursor = result.nextCursor;
    await delay(PAGE_DELAY_MS, signal);
  }
}

export async function collect(options: CollectionOptions): Promise<ScanState> {
  const { db, signal, userId, report } = options;
  const started = new Date().toISOString();
  const state: ScanState = {
    started_at: started, updated_at: started,
    bookmarks: "partial", folders: "not_checked", reason: "in_progress",
  };
  const persist = async () => {
    state.updated_at = new Date().toISOString();
    await saveState(db, state);
  };
  await persist();
  try {
    report("Scanning all bookmarks. Existing saved posts will be retained.");
    await collectTimeline(options, "Bookmarks");
    state.bookmarks = "complete";
    state.reason = "main_timeline_complete";
    await persist();

    const credentials = await readCredentials(userId);
    if (!credentials.queryIds["BookmarkFoldersSlice"]) {
      state.reason = "folder_query_not_captured";
      report("Main bookmarks complete. Open the X bookmarks page to capture the folder-list request.");
      await persist();
      return state;
    }
    state.folders = "partial";
    await persist();
    const folders = await collectFolderList(options);
    if (folders.length && !credentials.queryIds["BookmarkFolderTimeline"]) {
      state.reason = "folder_timeline_query_not_captured";
      report("Folder names saved; open a bookmark folder on X to capture folder timeline requests.");
      await persist();
      return state;
    }
    for (const folder of folders) {
      stopped(signal);
      report("Scanning folder: " + folder.name);
      await collectTimeline(options, "BookmarkFolderTimeline", folder.id);
      await delay(PAGE_DELAY_MS, signal);
    }
    state.folders = "complete";
    state.reason = "complete";
    await persist();
    report("Collection complete. Export the accumulated archive to JSON.");
    return state;
  } catch (error) {
    state.reason = error instanceof Error ? error.message : String(error);
    await persist();
    throw error;
  }
}

export function profileTimelineVariables(operation: ProfileOperation, targetUserId: string, cursor: string | null): Record<string, unknown> {
  const paged = cursor ? { cursor } : {};
  switch (operation) {
    case "UserOriginalsTimeline":
      return {
        userId: targetUserId,
        count: 20,
        includePromotedContent: false,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
        ...paged,
      };
    case "UserRepliesTimeline":
      return {
        userId: targetUserId,
        count: 20,
        includePromotedContent: false,
        withCommunity: true,
        withVoice: true,
        ...paged,
      };
    default:
      return { userId: targetUserId, count: 20, includePromotedContent: false, ...paged };
  }
}

export async function collectProfileTimeline(
  options: CollectionOptions,
  operation: ProfileOperation,
  targetUserId: string,
): Promise<{ total: number; profile: ProfileScanProfile | null }> {
  let profile: ProfileScanProfile | null = null;
  const total = await scanPages(options, {
    operation,
    buildVariables: (cursor) => profileTimelineVariables(operation, targetUserId, cursor),
    parse: (data, observedAt) => {
      const result = parseProfileTimeline(data, observedAt);
      if (result.valid && result.profile) profile = result.profile;
      return result.valid
        ? { valid: true, items: result.posts, nextCursor: result.nextCursor }
        : { valid: false, items: [], nextCursor: null, ...(result.detail ? { detail: result.detail } : {}) };
    },
    save: (items) => saveProfilePage(options.db, items, targetUserId),
    label: operation,
    invalidMessage: "X changed its profile timeline response. Partial results were preserved.",
  });
  return { total, profile };
}

function extractLookupUserId(response: unknown): string | null {
  const body = response as Record<string, unknown> | null;
  const data = body?.["data"] as Record<string, unknown> | undefined;
  const user = data?.["user"] as Record<string, unknown> | undefined;
  const result = (user?.["result"] ?? user) as Record<string, unknown> | undefined;
  const restId = result?.["rest_id"]
    ?? (result?.["legacy"] as Record<string, unknown> | undefined)?.["rest_id"];
  if (typeof restId === "string" && /^\d+$/u.test(restId)) return restId;
  if (typeof restId === "number" && Number.isSafeInteger(restId) && restId > 0) return String(restId);
  return null;
}

export async function collectProfile(
  options: CollectionOptions,
  requested?: { screenName?: string },
): Promise<ProfileScanState> {
  const { db, signal, userId, report } = options;
  const requestedScreenName = requested?.screenName?.replace(/^@/u, "");
  let target = await readProfileTarget(userId);
  if (requestedScreenName) {
    if (target?.screenName !== requestedScreenName || !target.targetUserId) {
      if (!/^[A-Za-z0-9_]{1,15}$/u.test(requestedScreenName)) {
        throw new RequestFailure("query", "Could not read a profile name from the profile tab's URL.");
      }
      const credentials = await readCredentials(userId);
      if (!credentials.queryIds["UserByScreenName"]) {
        throw new RequestFailure("query",
          "The lookup for @" + requestedScreenName + " was never captured. Reload https://x.com/"
          + requestedScreenName + " once in this browser, then try again.");
      }
      report("Resolving @" + requestedScreenName + " to an X user id.");
      const lookup = await requestWithRetry(
        userId,
        "UserByScreenName",
        { screen_name: requestedScreenName },
        signal,
        report,
      );
      const resolvedId = extractLookupUserId(lookup);
      if (!resolvedId) {
        throw new RequestFailure("response",
          "X could not resolve @" + requestedScreenName + " to a user id. Reload the profile tab and try again.");
      }
      target = {
        targetUserId: resolvedId,
        screenName: requestedScreenName,
        operation: credentials.queryIds["UserOriginalsTimeline"] ? "UserOriginalsTimeline"
          : credentials.queryIds["UserRepliesTimeline"] ? "UserRepliesTimeline"
          : credentials.queryIds["UserTweetsAndReplies"] ? "UserTweetsAndReplies" : "UserTweets",
        capturedAt: new Date().toISOString(),
      };
      await writeProfileTarget(userId, target);
    }
  } else if (target && !target.targetUserId && target.screenName) {
    throw new RequestFailure("query",
      "The profile @" + target.screenName + " has not been resolved to a user id yet. Reload https://x.com/"
      + target.screenName + " once in this browser, then try again.");
  }
  if (!target) {
    throw new RequestFailure("query",
      "No profile is captured. Visit a profile on x.com, or open the toolbar popup and click Download archive.");
  }
  const targetUserId = target.targetUserId!;
  const credentials = await readCredentials(userId);
  const originals = credentials.queryIds["UserOriginalsTimeline"] ? "UserOriginalsTimeline" as const : null;
  const replies = credentials.queryIds["UserRepliesTimeline"] ? "UserRepliesTimeline" as const : null;
  const renamed = [originals, replies].filter((operation): operation is "UserOriginalsTimeline" | "UserRepliesTimeline" => operation !== null);
  const operations: ProfileOperation[] = renamed.length
    ? renamed
    : credentials.queryIds["UserTweetsAndReplies"]
      ? ["UserTweetsAndReplies"]
      : credentials.queryIds["UserTweets"] ? ["UserTweets"] : [];
  const started = new Date().toISOString();
  const baseProfile: ProfileScanProfile = {
    user_id: targetUserId,
    screen_name: null,
    name: null,
    profile_image_url: null,
    followers_count: 0,
    verified: false,
    description: null,
  };
  const state: ProfileScanState = {
    started_at: started,
    updated_at: started,
    posts: "partial",
    reason: "in_progress",
    ...(operations.length ? { operation: operations[0] } : {}),
    profile: baseProfile,
  };
  const persist = async () => {
    state.updated_at = new Date().toISOString();
    await saveProfileState(db, targetUserId, state);
  };
  await persist();
  try {
    if (!operations.length) {
      throw new RequestFailure("query",
        "No profile timeline request captured. Reload the profile on x.com (Posts and Replies tabs), then try again.");
    }
    stopped(signal);
    const two = operations.length === 2;
    report(two
      ? "Scanning profile posts and replies. Existing saved posts are retained."
      : "Scanning profile timeline. Existing saved posts are retained.");
    let cumulativePosts = 0;
    let cumulativePages = 0;
    let mergedProfile: ProfileScanProfile | null = null;
    for (const operation of operations) {
      stopped(signal);
      let opPages = 0;
      const base = { posts: cumulativePosts, pages: cumulativePages };
      const opOptions: CollectionOptions = {
        ...options,
        progressBase: base,
        onProgress: (snapshot) => {
          opPages = snapshot.pages - base.pages;
          options.onProgress?.(snapshot);
        },
      };
      let result: { total: number; profile: ProfileScanProfile | null };
      try {
        result = await collectProfileTimeline(opOptions, operation, targetUserId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error("Scan of " + operation + " failed: " + message);
      }
      cumulativePosts += result.total;
      cumulativePages += opPages;
      if (result.profile) mergedProfile = mergedProfile ?? result.profile;
    }
    if (mergedProfile) state.profile = { ...baseProfile, ...mergedProfile };
    const learnedScreenName = state.profile?.screen_name ?? target.screenName;
    if (learnedScreenName && target.screenName !== learnedScreenName) {
      target = { ...target, screenName: learnedScreenName, targetUserId };
      await writeProfileTarget(userId, target);
    }
    state.posts = "complete";
    state.reason = operations.length === 2 ? "complete"
      : operations[0] === "UserOriginalsTimeline" ? "complete_without_replies"
      : operations[0] === "UserRepliesTimeline" ? "complete_without_posts"
      : operations[0] === "UserTweetsAndReplies" ? "complete"
      : "complete_without_replies";
    if (!operations.includes("UserRepliesTimeline") && !operations.includes("UserTweetsAndReplies")) {
      report("Only the Posts tab was captured. Open the Replies tab on x.com, then collect again to include replies.");
    }
    if (!operations.includes("UserOriginalsTimeline") && !operations.includes("UserTweetsAndReplies")
        && !operations.includes("UserTweets")) {
      report("Only the Replies tab was captured. Open the Posts tab on x.com, then collect again to include posts.");
    }
    await persist();
    report("Profile collection complete. Use Download archive to save JSON and media.");
    return state;
  } catch (error) {
    state.reason = error instanceof Error ? error.message : String(error);
    await persist();
    throw error;
  }
}
