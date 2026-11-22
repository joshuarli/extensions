import { createApiClient, createApiState } from "./api.ts";
import { TriageError } from "./errors.ts";
import { isApiRequest, LEASE_PORT_PREFIX, type ApiRequest, type ApiResponse } from "./messages.ts";
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

export interface ChatgptApi {
  handle(request: ApiRequest): Promise<ApiResponse>;
  leaseOpened(runId: string, leaseId: string): () => void;
  parseLeaseName(name: string): { runId: string; leaseId: string } | null;
}

export function createChatgptApi(): ChatgptApi {
  const chatgptFetch: typeof globalThis.fetch = (input, init) =>
    globalThis.fetch(typeof input === "string" && input.startsWith("/") ? `https://chatgpt.com${input}` : input, init);
  const client = createApiClient({
    fetch: chatgptFetch,
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
  return {
    handle: (request) => operator.handle(request),
    leaseOpened: (runId, leaseId) => operator.leaseOpened(runId, leaseId),
    parseLeaseName(name) {
      if (!name.startsWith(LEASE_PORT_PREFIX)) return null;
      const [runId, leaseId, extra] = name.slice(LEASE_PORT_PREFIX.length).split(":");
      if (!runId || !leaseId || extra !== undefined) return null;
      return { runId, leaseId };
    },
  };
}

export { isApiRequest };
