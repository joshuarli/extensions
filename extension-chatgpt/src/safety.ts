import { TriageError } from "./errors.ts";

export interface ArmedJob {
  id: string;
  action: "delete" | "archive" | "unarchive" | "rename" | "move";
}

export const MAX_ATTEMPTS_PER_CHAT = 8;

// The boundary that issues destructive PATCHes stays disarmed until the dashboard
// arms an explicit job list. A change outside that list is refused loudly.
export class DeletionGuard {
  private runId: string | null = null;
  private allowed = new Map<string, ArmedJob["action"]>();
  private attempts = new Map<string, number>();

  arm(runId: string, jobs: readonly ArmedJob[]): void {
    this.runId = runId;
    this.allowed = new Map(jobs.map((job) => [job.id, job.action]));
    this.attempts = new Map();
  }

  disarm(runId: string): void {
    if (this.runId !== runId) return;
    this.runId = null;
    this.allowed = new Map();
    this.attempts = new Map();
  }

  armedRunId(): string | null {
    return this.runId;
  }

  authorize(runId: string, id: string, action: ArmedJob["action"]): void {
    if (!runId || this.runId !== runId) {
      throw new TriageError("auth", "No authorized run is armed. No change was sent.");
    }
    const expected = this.allowed.get(id);
    if (expected !== action) {
      throw new TriageError("auth", `Chat ${id} was not authorized for ${action}. No change was sent.`);
    }
    const attempts = (this.attempts.get(id) ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS_PER_CHAT) {
      throw new TriageError("auth", `Chat ${id} exceeded its attempt limit. No change was sent.`);
    }
    this.attempts.set(id, attempts);
  }
}

export function requiresTypedConfirmation(deleteCount: number, threshold: number): boolean {
  return deleteCount >= threshold;
}
