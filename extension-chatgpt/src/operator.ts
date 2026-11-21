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
  leaseOpened(runId: string): void;
  leaseClosed(runId: string): void;
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
  const leases = new Map<string, number>();

  async function value(request: ApiRequest): Promise<unknown> {
    switch (request.op) {
      case "arm": {
        if (!leases.has(request.runId)) {
          throw new TriageError("auth", "The dashboard isn't holding this run open. No change was sent.");
        }
        const accountId = await signedInAccount(client);
        if (accountId !== request.accountId) {
          throw new TriageError("auth", "The signed-in ChatGPT account isn't the one this run was reviewed for. No change was sent.");
        }
        guard.arm(request.runId, request.accountId, request.commands);
        return true;
      }
      case "disarm":
        guard.disarm(request.runId);
        return true;
      case "change": {
        const command = guard.authorize(request.runId, request.accountId, request.id);
        if (client.accountId() !== request.accountId) {
          throw new TriageError("auth", "The signed-in ChatGPT account changed. No change was sent.");
        }
        await client.change(command);
        return true;
      }
      case "session":
        return { accountId: await signedInAccount(client) };
      default:
        break;
    }
    if (client.accountId() == null) await signedInAccount(client);
    switch (request.op) {
      case "list":
        return client.list(request.scope, (found, total, waiting) => onListProgress(request.scope, found, total, waiting));
      case "projects":
        return client.projects();
      case "conversation":
        return client.conversation(request.id);
      case "record":
        return client.record(request.id);
      case "probe":
        return client.probe(request.id);
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
    leaseOpened(runId) {
      leases.set(runId, (leases.get(runId) ?? 0) + 1);
    },
    leaseClosed(runId) {
      const open = (leases.get(runId) ?? 1) - 1;
      if (open > 0) {
        leases.set(runId, open);
        return;
      }
      leases.delete(runId);
      guard.disarm(runId);
    },
    armedRunId() {
      return guard.armedRunId();
    },
  };
}
