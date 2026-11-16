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
  openExporter: "x-archive-open-exporter",
  collectProfile: "x-archive-collect-profile",
  collectBookmarks: "x-archive-collect-bookmarks",
} as const;

const X_ARCHIVE_MENU_PATTERNS = ["*://x.com/*", "*://twitter.com/*"];

export function installXBookmarksContextMenus(): void {
  void chrome.contextMenus.removeAll().then(() => {
    const page: chrome.contextMenus.CreateProperties = { contexts: ["page"], documentUrlPatterns: [...X_ARCHIVE_MENU_PATTERNS] };
    chrome.contextMenus.create({ ...page, id: X_ARCHIVE_MENU.openExporter, title: "Open X archive exporter" });
    chrome.contextMenus.create({ ...page, id: X_ARCHIVE_MENU.collectProfile, title: "Collect and download profile posts…" });
    chrome.contextMenus.create({ ...page, id: X_ARCHIVE_MENU.collectBookmarks, title: "Collect and download bookmarks…" });
  }).catch((error: unknown) => console.warn("X archive context menus setup failed", error));
}

export function xBookmarksCollectProfileUrl(exporterUrl: string, pageUrl: string | undefined): string {
  const screenName = pageUrl ? parseProfileScreenName(pageUrl) : null;
  return exporterUrl + "?collect=profile&export=1"
    + (screenName ? "&profile=" + encodeURIComponent(screenName) : "");
}

export function handleXBookmarksContextMenuClick(info: chrome.contextMenus.OnClickData): void {
  updateQueue = updateQueue.then(async () => {
    const exporterUrl = chrome.runtime.getURL("features/x-bookmarks/options.html");
    switch (info.menuItemId) {
      case X_ARCHIVE_MENU.openExporter:
        await chrome.tabs.create({ url: exporterUrl });
        return;
      case X_ARCHIVE_MENU.collectProfile:
        await chrome.tabs.create({ url: xBookmarksCollectProfileUrl(exporterUrl, info.pageUrl) });
        return;
      case X_ARCHIVE_MENU.collectBookmarks:
        await chrome.tabs.create({ url: exporterUrl + "?collect=bookmarks&export=1" });
        return;
    }
  }).catch((error: unknown) => console.warn("X archive context menu action failed", error));
}

export const xProfileLastCaptureKey = "x_profile_last_capture";
export const xProfileUnmatchedOpsKey = "x_profile_unmatched_ops";

const unmatchedLogged = new Set<string>();

async function recordUnmatchedOperation(operation: string): Promise<void> {
  if (unmatchedLogged.has(operation)) return;
  unmatchedLogged.add(operation);
  const stored = (await chrome.storage.local.get(xProfileUnmatchedOpsKey))[xProfileUnmatchedOpsKey];
  const list = Array.isArray(stored)
    ? stored.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (list.length < 100 && !list.includes(operation)) {
    await chrome.storage.local.set({ [xProfileUnmatchedOpsKey]: [...list, operation] });
  }
}

export async function readXProfileUnmatchedOps(): Promise<string[]> {
  const stored = (await chrome.storage.local.get(xProfileUnmatchedOpsKey))[xProfileUnmatchedOpsKey];
  return Array.isArray(stored)
    ? stored.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function readXProfileLastCapture(): Promise<{ operation: string; targetUserId?: string; at: string } | null> {
  const stored = (await chrome.storage.local.get(xProfileLastCaptureKey))[xProfileLastCaptureKey];
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  if (typeof record["operation"] !== "string" || typeof record["at"] !== "string") return null;
  return {
    operation: record["operation"],
    at: record["at"],
    ...(typeof record["targetUserId"] === "string" ? { targetUserId: record["targetUserId"] } : {}),
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
          await recordUnmatchedOperation(op);
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
