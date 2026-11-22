import type { ApiClient } from "./api.ts";
import { isFailureKind, TriageError } from "./errors.ts";
import type { ApiRequest, ApiResponse, FailurePayload } from "./messages.ts";
import { MutationGuard } from "./safety.ts";

function failurePayload(error: unknown): FailurePayload {
  if (error instanceof TriageError) {
    return { kind: isFailureKind(error.kind) ? error.kind : "http", message: error.message, until: error.until };
  }
  return { kind: "http", message: error instanceof Error ? error.message : String(error), until: 0 };
}

export interface Operator {
  handle(request: ApiRequest): Promise<ApiResponse>;
  leaseOpened(runId: string, leaseId: string): () => void;
  armedRunId(): string | null;
}

async function signedInAccount(client: ApiClient): Promise<string> {
  const { accountId } = await client.session();
  if (!accountId) {
    throw new TriageError("auth", "Couldn't identify the signed-in ChatGPT account, so changes are switched off.");
  }
  return accountId;
}

export function createOperator(
  client: ApiClient,
  onListProgress: (scope: "active" | "archived", found: number, total: number | null, waiting: boolean) => void,
): Operator {
  const guard = new MutationGuard();
  const leases = new Map<string, string>();

  // Any sign that another account is signed in disarms the run before anything else happens.
  async function requireAccount(accountId: string): Promise<void> {
    let current: string;
    try {
      current = await signedInAccount(client);
    } catch (error) {
      disarmAll();
      throw error;
    }
    if (current !== accountId) {
      disarmAll();
      throw new TriageError("auth", "The signed-in ChatGPT account isn't the one the dashboard loaded. Nothing was read or changed.");
    }
  }

  function disarmAll(): void {
    const armed = guard.armedRunId();
    if (armed) guard.disarm(armed);
  }

  async function value(request: ApiRequest): Promise<unknown> {
    switch (request.op) {
      case "session":
        try {
          return { accountId: await signedInAccount(client) };
        } catch (error) {
          disarmAll();
          throw error;
        }
      case "arm": {
        if (leases.get(request.runId) !== request.leaseId) {
          throw new TriageError("auth", "The dashboard isn't holding this run open. No change was sent.");
        }
        await requireAccount(request.accountId);
        if (leases.get(request.runId) !== request.leaseId) {
          throw new TriageError("auth", "The dashboard closed this run while it was being authorized. No change was sent.");
        }
        guard.arm(request.runId, request.accountId, request.commands);
        return true;
      }
      case "change": {
        if (leases.get(request.runId) !== request.leaseId) {
          throw new TriageError("auth", "The dashboard's authorization for this change ended. No change was sent.");
        }
        const authorize = guard.permit(request.runId, request.accountId, request.id);
        try {
          await client.change({ accountId: request.accountId, authorize });
        } catch (error) {
          if (error instanceof TriageError && error.kind === "auth" && leases.get(request.runId) === request.leaseId) {
            guard.disarm(request.runId);
          }
          throw error;
        }
        return true;
      }
      default:
        break;
    }
    await requireAccount(request.accountId);
    switch (request.op) {
      case "list":
        return client.list(request.accountId, request.scope, (found, total, waiting) => onListProgress(request.scope, found, total, waiting));
      case "projects":
        return client.projects(request.accountId);
      case "conversation":
        return client.conversation(request.accountId, request.id);
      case "record":
        return client.record(request.accountId, request.id);
      case "probe":
        return client.probe(request.accountId, request.id);
    }
  }

  return {
    async handle(request) {
      const response = { kind: "chatgpt/api:response" as const, requestId: request.requestId };
      try {
        return { ...response, ok: true, value: await value(request), error: null };
      } catch (error) {
        return { ...response, ok: false, value: null, error: failurePayload(error) };
      }
    },
    leaseOpened(runId, leaseId) {
      guard.disarm(runId);
      leases.set(runId, leaseId);
      return () => {
        if (leases.get(runId) !== leaseId) return;
        leases.delete(runId);
        guard.disarm(runId);
      };
    },
    armedRunId() {
      return guard.armedRunId();
    },
  };
}
