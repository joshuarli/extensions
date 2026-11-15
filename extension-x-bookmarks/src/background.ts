import {
  captureRequest,
  credentialKey,
  currentUserId,
  isProfileOperation,
  mergeCapture,
  readCredentials,
  readProfileCaptureArmed,
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

export function handleXBookmarksRequest(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  updateQueue = updateQueue.then(async () => {
    const userId = await currentUserId();
    if (!userId) return;
    const armed = await readProfileCaptureArmed(userId);
    const capture = captureRequest(details.url, details.initiator, details.requestHeaders ?? [], {
      profileCaptureArmed: armed,
    });
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
