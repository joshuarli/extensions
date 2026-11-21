import { describe, expect, it } from "vitest";
import { TriageError } from "../src/errors.ts";
import { DeletionGuard, MAX_ATTEMPTS_PER_CHAT, requiresTypedConfirmation, type ArmedJob } from "../src/safety.ts";

function attempt(guard: DeletionGuard, runId: string, id: string, action: ArmedJob["action"]): string | null {
  try {
    guard.authorize(runId, id, action);
    return null;
  } catch (error) {
    return error instanceof TriageError ? error.message : String(error);
  }
}

describe("destructive-action guardrail", () => {
  it("is disarmed by default, so no change can be sent before confirmation", () => {
    const guard = new DeletionGuard();
    expect(attempt(guard, "run-1", "c1", "delete")).toContain("No authorized run");
    expect(attempt(guard, "", "c1", "delete")).toContain("No authorized run");
  });

  it("refuses a chat that was not in the confirmed job list", () => {
    const guard = new DeletionGuard();
    guard.arm("run-1", [
      { id: "c1", action: "delete" },
      { id: "c2", action: "archive" },
    ]);
    expect(attempt(guard, "run-1", "c1", "delete")).toBeNull();
    expect(attempt(guard, "run-1", "c2", "archive")).toBeNull();
    expect(attempt(guard, "run-1", "c3", "delete")).toContain("not authorized");
    expect(attempt(guard, "run-1", "c1", "archive")).toContain("not authorized");
    expect(attempt(guard, "run-2", "c1", "delete")).toContain("No authorized run");
  });

  it("an attempt to delete every chat is refused except for the explicitly marked ones", () => {
    const guard = new DeletionGuard();
    const marked = ["chat-1", "chat-2"];
    guard.arm("run-1", marked.map((id) => ({ id, action: "delete" as const })));
    const everyChat = Array.from({ length: 200 }, (_, index) => `chat-${index + 1}`);
    const sent = everyChat.filter((id) => attempt(guard, "run-1", id, "delete") === null);
    expect(sent).toEqual(marked);
    expect(everyChat.length - sent.length).toBe(198);
  });

  it("caps repeated attempts for one chat and can be disarmed", () => {
    const guard = new DeletionGuard();
    guard.arm("run-1", [{ id: "c1", action: "delete" }]);
    for (let index = 0; index < MAX_ATTEMPTS_PER_CHAT; index += 1) {
      expect(attempt(guard, "run-1", "c1", "delete")).toBeNull();
    }
    expect(attempt(guard, "run-1", "c1", "delete")).toContain("attempt limit");
    guard.disarm("run-1");
    expect(guard.armedRunId()).toBeNull();
    expect(attempt(guard, "run-1", "c1", "delete")).toContain("No authorized run");
  });

  it("requires typing the count for a large delete batch but not a small one", () => {
    expect(requiresTypedConfirmation(1, 20)).toBe(false);
    expect(requiresTypedConfirmation(19, 20)).toBe(false);
    expect(requiresTypedConfirmation(20, 20)).toBe(true);
    expect(requiresTypedConfirmation(200, 20)).toBe(true);
  });
});
