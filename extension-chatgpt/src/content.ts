import { createApiClient, createApiState } from "./api.ts";
import { TriageError, type FailureKind } from "./errors.ts";
import { isApiRequest, type ApiRequest, type ApiResponse, type FailurePayload } from "./messages.ts";
import { DeletionGuard } from "./safety.ts";

const state = createApiState();
const guard = new DeletionGuard();

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
  state,
  now: () => Date.now(),
  sleep,
});

const FAILURE_KINDS: FailureKind[] = ["aborted", "offline", "auth", "cooldown", "ratelimit", "transient", "notfound", "http", "compat"];

function failurePayload(error: unknown): FailurePayload {
  if (error instanceof TriageError) {
    return {
      kind: FAILURE_KINDS.includes(error.kind) ? error.kind : "http",
      message: error.message,
      until: error.until,
    };
  }
  return {
    kind: "http",
    message: error instanceof Error ? error.message : String(error),
    until: 0,
  };
}

async function handle(request: ApiRequest): Promise<ApiResponse> {
  const response = { kind: "chatgpt/api:response" as const, requestId: request.requestId };
  try {
    if (request.op === "arm") {
      guard.arm(request.runId, request.jobs);
      return { ...response, ok: true, value: true, error: null };
    }
    if (request.op === "disarm") {
      guard.disarm(request.runId);
      return { ...response, ok: true, value: true, error: null };
    }
    if (request.op !== "session" && state.token == null) await client.session();
    let value: unknown;
    switch (request.op) {
      case "session":
        value = await client.session();
        break;
      case "list":
        value = await client.list(request.scope, (found, total, waiting) => {
          void chrome.runtime.sendMessage({
            kind: "chatgpt/list-progress",
            scope: request.scope,
            found,
            total,
            waiting,
          }).catch(() => undefined);
        });
        break;
      case "projects":
        value = await client.projects();
        break;
      case "conversation":
        value = await client.conversation(request.id);
        break;
      case "detail":
        value = await client.detail(request.id);
        break;
      case "change":
        guard.authorize(request.runId, request.id, request.action);
        await client.change(request.id, request.body as Record<string, string | boolean>);
        value = true;
        break;
    }
    return { ...response, ok: true, value, error: null };
  } catch (error) {
    return { ...response, ok: false, value: null, error: failurePayload(error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isApiRequest(message)) return false;
  void handle(message).then((response) => sendResponse(response));
  return true;
});

void client.session().catch(() => undefined);
