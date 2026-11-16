import {
  captureRequest,
  credentialKey,
  currentUserId,
  isProfileOperation,
  mergeCapture,
  parseProfileScreenName,
  readCredentials,
  writeProfileTarget,
} from "./capture.ts";
import {
  archiveRunKey,
  decodeArchiveRun,
} from "./archive-run.ts";
import { startXArchiveRun } from "./archive-engine.ts";

export const xBookmarksRequestFilter: chrome.webRequest.RequestFilter = {
  urls: ["https://x.com/i/api/graphql/*"],
  types: ["xmlhttprequest", "other"],
};

let updateQueue: Promise<void> = Promise.resolve();

export function installXBookmarksHeaderRule(): void {
  void chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Origin", operation: "set", value: "https://x.com" },
          { header: "Referer", operation: "set", value: "https://x.com/" },
        ],
      },
      condition: {
        urlFilter: "https://x.com/i/api/graphql/",
        resourceTypes: ["xmlhttprequest"],
        initiatorDomains: [chrome.runtime.id],
      },
    }, {
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://x.com/" },
        ],
      },
      condition: {
        regexFilter: "^https://(pbs|video)\\.twimg\\.com/",
        resourceTypes: ["xmlhttprequest", "media", "image", "other"],
        initiatorDomains: [chrome.runtime.id],
      },
    }],
  }).catch((error: unknown) => console.warn("X media header setup failed", error));
}

const X_ARCHIVE_MENU = {
  collectProfile: "x-archive-collect-profile",
  collectBookmarks: "x-archive-collect-bookmarks",
} as const;

const X_ARCHIVE_MENU_PATTERNS = ["*://x.com/*", "*://twitter.com/*"];

export function installXBookmarksContextMenus(): void {
  void chrome.contextMenus.removeAll().then(() => {
    const page: chrome.contextMenus.CreateProperties = { contexts: ["page"], documentUrlPatterns: [...X_ARCHIVE_MENU_PATTERNS] };
    chrome.contextMenus.create({ ...page, id: X_ARCHIVE_MENU.collectProfile, title: "Collect and download profile posts…" });
    chrome.contextMenus.create({ ...page, id: X_ARCHIVE_MENU.collectBookmarks, title: "Collect and download bookmarks…" });
  }).catch((error: unknown) => console.warn("X archive context menus setup failed", error));
}

export function installArchiveRunBadge(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[archiveRunKey] as chrome.storage.StorageChange | undefined;
    const run = change ? decodeArchiveRun(change.newValue) : undefined;
    if (!run || !change) {
      if (change && !change.newValue) void chrome.action.setBadgeText({ text: "" });
      return;
    }
    if (run.phase === "collecting" || run.phase === "exporting") {
      void chrome.action.setBadgeText({ text: "…" });
      void chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
      return;
    }
    if (run.phase === "done") {
      void chrome.action.setBadgeText({ text: "✓" });
      void chrome.action.setBadgeBackgroundColor({ color: "#188038" });
      return;
    }
    void chrome.action.setBadgeText({ text: "!" });
    void chrome.action.setBadgeBackgroundColor({ color: "#c5221f" });
  });
}

export function clearArchiveBadge(): void {
  void chrome.action.setBadgeText({ text: "" });
}

export function handleXBookmarksContextMenuClick(info: chrome.contextMenus.OnClickData): void {
  updateQueue = updateQueue.then(async () => {
    switch (info.menuItemId) {
      case X_ARCHIVE_MENU.collectProfile: {
        const screenName = info.pageUrl ? parseProfileScreenName(info.pageUrl) : null;
        const result = await startXArchiveRun("download", "profile", screenName ? { screenName } : {});
        if (!result.ok) console.warn("X archive profile run did not start:", result.error);
        return;
      }
      case X_ARCHIVE_MENU.collectBookmarks: {
        const result = await startXArchiveRun("download", "bookmarks");
        if (!result.ok) console.warn("X archive bookmarks run did not start:", result.error);
        return;
      }
    }
  }).catch((error: unknown) => console.warn("X archive context menu action failed", error));
}

export const xProfileLastCaptureKey = "x_profile_last_capture";
export const xProfileUnmatchedOpsKey = "x_profile_unmatched_ops";

export interface UnmatchedOperation {
  operation: string;
  variables?: string;
}

function parseUnmatchedOps(stored: unknown): UnmatchedOperation[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry): UnmatchedOperation[] => {
    if (typeof entry === "string") return [{ operation: entry }];
    if (entry !== null && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      if (typeof record["operation"] !== "string") return [];
      return [{
        operation: record["operation"],
        ...(typeof record["variables"] === "string" ? { variables: record["variables"] } : {}),
      }];
    }
    return [];
  });
}

const unmatchedLogged = new Set<string>();

async function recordUnmatchedOperation(operation: string, url: string): Promise<void> {
  if (unmatchedLogged.has(operation)) return;
  unmatchedLogged.add(operation);
  let variables: string | undefined;
  if (/timeline/iu.test(operation)) {
    try {
      const raw = new URL(url).searchParams.get("variables");
      if (raw) variables = raw.length > 1500 ? raw.slice(0, 1500) + "…" : raw;
    } catch { /* Diagnostics must never break capture. */ }
  }
  const stored = (await chrome.storage.local.get(xProfileUnmatchedOpsKey))[xProfileUnmatchedOpsKey];
  const list = parseUnmatchedOps(stored);
  if (list.length < 100 && !list.some((entry) => entry.operation === operation)) {
    await chrome.storage.local.set({ [xProfileUnmatchedOpsKey]: [...list, { operation, ...(variables ? { variables } : {}) }] });
  }
}

export async function readXProfileUnmatchedOps(): Promise<UnmatchedOperation[]> {
  return parseUnmatchedOps((await chrome.storage.local.get(xProfileUnmatchedOpsKey))[xProfileUnmatchedOpsKey]);
}

export async function readXProfileLastCapture(): Promise<{ operation: string; targetUserId?: string; variables?: string; at: string } | null> {
  const stored = (await chrome.storage.local.get(xProfileLastCaptureKey))[xProfileLastCaptureKey];
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if (typeof record["operation"] !== "string" || typeof record["at"] !== "string") return null;
  return {
    operation: record["operation"],
    at: record["at"],
    ...(typeof record["targetUserId"] === "string" ? { targetUserId: record["targetUserId"] } : {}),
    ...(typeof record["variables"] === "string" ? { variables: record["variables"] } : {}),
  };
}

export function handleXBookmarksRequest(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  updateQueue = updateQueue.then(async () => {
    const userId = await currentUserId();
    if (!userId) return;
    const capture = captureRequest(details.url, details.initiator, details.requestHeaders ?? []);
    if (!capture) {
      try {
        const op = /^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/([A-Za-z0-9_]+)$/u
          .exec(new URL(details.url).pathname)?.[1];
        if (op && (details.initiator === "https://x.com" || details.initiator === "https://twitter.com")) {
          await recordUnmatchedOperation(op, details.url);
        }
      } catch { /* Diagnostics must never break capture. */ }
      return;
    }
    const previous = await readCredentials(userId);
    await chrome.storage.local.set({
      [credentialKey(userId)]: mergeCapture(previous, capture),
      [xProfileLastCaptureKey]: {
        operation: capture.operation,
        ...(capture.targetUserId ? { targetUserId: capture.targetUserId } : {}),
        at: new Date().toISOString(),
        ...(capture.variables ? { variables: capture.variables } : {}),
      },
    });
    if (capture.targetUserId && isProfileOperation(capture.operation)) {
      await writeProfileTarget(userId, {
        targetUserId: capture.targetUserId,
        operation: capture.operation,
        capturedAt: new Date().toISOString(),
      });
    }
  }).catch(() => { /* The options page reports missing or stale credentials. */ });
}
