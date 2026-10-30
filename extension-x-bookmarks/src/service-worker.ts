import { captureRequest, credentialKey, currentUserId, mergeCapture, readCredentials } from "./capture.ts";

const GRAPHQL_URLS = ["https://x.com/i/api/graphql/*"];
let updateQueue: Promise<void> = Promise.resolve();

function installHeaderRule(): void {
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

chrome.runtime.onInstalled.addListener(installHeaderRule);
chrome.runtime.onStartup.addListener(installHeaderRule);
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.webRequest.onSendHeaders.addListener((details) => {
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
}, { urls: GRAPHQL_URLS, types: ["xmlhttprequest"] }, ["requestHeaders", "extraHeaders"]);
