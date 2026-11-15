import {
  captureRequest,
  credentialKey,
  currentUserId,
  isProfileOperation,
  mergeCapture,
  readCredentials,
  writeProfileTarget,
} from "./capture.ts";

export const xBookmarksRequestFilter: chrome.webRequest.RequestFilter = {
  urls: ["https://x.com/i/api/graphql/*"],
  types: ["xmlhttprequest"],
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

export function handleXBookmarksContextMenuClick(info: chrome.contextMenus.OnClickData): void {
  updateQueue = updateQueue.then(async () => {
    const exporterUrl = chrome.runtime.getURL("features/x-bookmarks/options.html");
    switch (info.menuItemId) {
      case X_ARCHIVE_MENU.openExporter:
        await chrome.tabs.create({ url: exporterUrl });
        return;
      case X_ARCHIVE_MENU.collectProfile:
        await chrome.tabs.create({ url: exporterUrl + "?collect=profile&export=1" });
        return;
      case X_ARCHIVE_MENU.collectBookmarks:
        await chrome.tabs.create({ url: exporterUrl + "?collect=bookmarks&export=1" });
        return;
    }
  }).catch((error: unknown) => console.warn("X archive context menu action failed", error));
}

export function handleXBookmarksRequest(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  updateQueue = updateQueue.then(async () => {
    const userId = await currentUserId();
    if (!userId) return;
    const capture = captureRequest(details.url, details.initiator, details.requestHeaders ?? []);
    if (!capture) return;
    const previous = await readCredentials(userId);
    await chrome.storage.local.set({
      [credentialKey(userId)]: mergeCapture(previous, capture),
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
