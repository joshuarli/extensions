import { createApiClient, createApiState } from "./api.ts";
import { TriageError } from "./errors.ts";
import { isApiRequest, LEASE_PORT_PREFIX } from "./messages.ts";
import { createOperator } from "./operator.ts";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TriageError("aborted", "Stopped."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort(): void {
      clearTimeout(timer);
      reject(new TriageError("aborted", "Stopped."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const client = createApiClient({
  fetch: globalThis.fetch.bind(globalThis),
  state: createApiState(),
  now: () => Date.now(),
  sleep,
});

const operator = createOperator(
  client,
  (scope, found, total, waiting) => {
    void chrome.runtime.sendMessage({ kind: "chatgpt/list-progress", scope, found, total, waiting }).catch(() => undefined);
  },
  (scope, requestId, chats) => {
    void chrome.runtime.sendMessage({ kind: "chatgpt/list-page", scope, requestId, chats }).catch(() => undefined);
  },
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isApiRequest(message)) return false;
  void operator.handle(message).then((response) => sendResponse(response));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(LEASE_PORT_PREFIX)) return;
  const [runId, leaseId, extra] = port.name.slice(LEASE_PORT_PREFIX.length).split(":");
  if (!runId || !leaseId || extra !== undefined) return;
  const revoke = operator.leaseOpened(runId, leaseId);
  port.onDisconnect.addListener(revoke);
  port.postMessage({ kind: "chatgpt/lease:ready" });
});
