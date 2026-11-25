import {
  captureErrorKey,
  captureRequest,
  credentialKey,
  currentUserId,
  mergeCapture,
  readCredentials,
} from "./capture.ts";

export const xArchiveRequestFilter: chrome.webRequest.RequestFilter = {
  urls: ["https://x.com/i/api/graphql/*"],
  types: ["xmlhttprequest", "other"],
};

let updateQueue: Promise<void> = Promise.resolve();
const pendingOperations = new Set<string>();

export function handleXArchiveRequest(
  details: chrome.webRequest.OnSendHeadersDetails,
): void {
  const capture = captureRequest(details.url, details.initiator, details.requestHeaders ?? [], details.method);
  if (!capture || pendingOperations.has(capture.operation)) return;
  pendingOperations.add(capture.operation);
  updateQueue = updateQueue.then(async () => {
    let userId: string | null = null;
    try {
      userId = await currentUserId();
      if (!userId) return;
      const previous = await readCredentials(userId);
      await chrome.storage.local.set({
        [credentialKey(userId)]: mergeCapture(previous, capture),
        [captureErrorKey(userId)]: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await chrome.storage.local.set({
          [captureErrorKey(userId ?? "unknown")]: { message, at: new Date().toISOString() },
        });
      } catch (persistError) {
        console.warn("Could not persist X capture error", persistError);
      }
    } finally {
      pendingOperations.delete(capture.operation);
    }
  });
}
