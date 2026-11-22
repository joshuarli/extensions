import {
  captureRequest,
  credentialKey,
  currentUserId,
  mergeCapture,
  readCredentials,
} from "./capture.ts";

export const xBookmarksRequestFilter: chrome.webRequest.RequestFilter = {
  urls: ["https://x.com/i/api/graphql/*"],
  types: ["xmlhttprequest", "other"],
};

let updateQueue: Promise<void> = Promise.resolve();

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
  }).catch(() => { /* Credential capture must never break page requests. */ });
}
