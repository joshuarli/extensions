import { TriageError } from "./errors.ts";
import { sameCommand, type Command } from "./model.ts";

export const MAX_ATTEMPTS_PER_CHAT = 8;

interface Armed {
  runId: string;
  accountId: string;
  commands: Map<string, Command>;
  attempts: Map<string, number>;
}

function refused(message: string): TriageError {
  return new TriageError("auth", `${message} No change was sent.`);
}

// The boundary that issues PATCHes stays disarmed until the dashboard arms an exact
// command list for one run and account. It hands back the armed command, so the
// caller never chooses what is written.
export class MutationGuard {
  private armed: Armed | null = null;

  arm(runId: string, accountId: string, commands: readonly Command[]): void {
    if (!runId || !accountId) throw refused("A run needs an id and an account.");
    const next = new Map<string, Command>();
    for (const command of commands) {
      if (next.has(command.id)) throw refused(`Chat ${command.id} appears twice in the run.`);
      next.set(command.id, command);
    }
    if (!next.size) throw refused("The run has no changes.");
    const current = this.armed;
    if (current && current.runId !== runId) {
      throw refused("Another run is already authorized. Stop it first.");
    }
    if (current) {
      const same = current.accountId === accountId
        && current.commands.size === next.size
        && [...next.values()].every((command) => {
          const existing = current.commands.get(command.id);
          return existing != null && sameCommand(existing, command);
        });
      if (!same) throw refused("This run was authorized with a different list.");
      return;
    }
    this.armed = { runId, accountId, commands: next, attempts: new Map() };
  }

  disarm(runId: string): void {
    if (this.armed?.runId === runId) this.armed = null;
  }

  armedRunId(): string | null {
    return this.armed?.runId ?? null;
  }

  permit(runId: string, accountId: string, id: string): () => Command {
    const armed = this.armed;
    this.commandFor(runId, accountId, id);
    return () => {
      if (this.armed !== armed) throw refused("The authorization for this change ended.");
      return this.authorize(runId, accountId, id);
    };
  }

  private commandFor(runId: string, accountId: string, id: string): { armed: Armed; command: Command } {
    const armed = this.armed;
    if (!runId || armed?.runId !== runId) throw refused("No authorized run is armed.");
    if (armed.accountId !== accountId) throw refused("The run was authorized for a different account.");
    const command = armed.commands.get(id);
    if (!command) throw refused(`Chat ${id} was not authorized.`);
    return { armed, command };
  }

  authorize(runId: string, accountId: string, id: string): Command {
    const { armed, command } = this.commandFor(runId, accountId, id);
    const attempts = (armed.attempts.get(id) ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS_PER_CHAT) throw refused(`Chat ${id} exceeded its attempt limit.`);
    armed.attempts.set(id, attempts);
    return command;
  }
}

export function requiresTypedConfirmation(deleteCount: number, threshold: number): boolean {
  return deleteCount >= threshold;
}
