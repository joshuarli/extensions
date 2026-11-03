import { captureRequest, credentialKey, currentUserId, mergeCapture, readCredentials } from "./capture.ts";

export const xBookmarksRequestFilter: chrome.webRequest.RequestFilter = {
  urls: ["https://x.com/i/api/graphql/*"],
  types: ["xmlhttprequest"],
};

let updateQueue: Promise<void> = Promise.resolve();

export function installXBookmarksHeaderRule(): void {
  void chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
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
    }],
  }).catch((error: unknown) => console.warn("X bookmarks header setup failed", error));
}

export function handleXBookmarksRequest(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  const capture = captureRequest(details.url, details.initiator, details.requestHeaders ?? []);
  if (!capture) return;
  updateQueue = updateQueue.then(async () => {
    const userId = await currentUserId();
    if (!userId) return;
    const previous = await readCredentials(userId);
    await chrome.storage.local.set({
      [credentialKey(userId)]: mergeCapture(previous, capture),
    });
  }).catch(() => { /* The options page reports missing or stale credentials. */ });
}
