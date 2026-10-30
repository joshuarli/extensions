import { Effect } from "effect";
import { graphqlRequest, RequestFailure } from "./api.ts";
import { readCredentials, type Operation } from "./capture.ts";
import { parseTimeline, parseFolders, type Folder } from "./parser.ts";
import { savePage, saveFolders, saveState, type ScanState } from "./storage.ts";

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

export interface CollectionOptions {
  userId: string;
  db: IDBDatabase;
  signal: AbortSignal;
  report: (message: string) => void;
}

export async function collectTimeline(
  options: CollectionOptions,
  operation: "Bookmarks" | "BookmarkFolderTimeline",
  folderId?: string,
): Promise<number> {
  const { userId, db, signal, report } = options;
  const visited = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  let total = 0;
  let empty = 0;
  while (true) {
    stopped(signal);
    const variables: Record<string, unknown> = operation === "Bookmarks"
      ? { count: 100 }
      : { bookmark_collection_id: folderId, count: 50, includePromotedContent: false };
    if (cursor) variables["cursor"] = cursor;
    const response = await requestWithRetry(userId, operation, variables, signal, report);
    stopped(signal);
    const result = parseTimeline(response, new Date().toISOString());
    if (!result.valid) throw new Error("X changed its timeline response. Partial results were preserved.");
    pages++;
    if (result.bookmarks.length) {
      await savePage(db, result.bookmarks, folderId);
      total += result.bookmarks.length;
      empty = 0;
    } else {
      empty++;
    }
    report(operation + ": " + total + " posts across " + pages + " pages saved.");
    const next = result.nextCursor;
    if (!next) return total;
    if (visited.has(next) || next === cursor) throw new Error("X returned a repeated cursor. Collection is partial.");
    if (empty >= MAX_EMPTY_PAGES) throw new Error("X returned three empty pages. Collection is partial.");
    visited.add(next);
    cursor = next;
    await delay(PAGE_DELAY_MS + Math.random() * 1250, signal);
  }
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
