export interface Clock {
  now(): number;
  advance(ms: number): void;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export function createClock(start = 1_700_000_000_000): Clock {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    async sleep(ms, signal) {
      if (signal?.aborted) throw new Error("aborted");
      current += Math.max(0, ms);
    },
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function makeChat(id: string, overrides: Partial<{
  title: string;
  createdMs: number;
  updatedMs: number;
  projectId: string | null;
  gptId: string | null;
  pinned: boolean;
  archived: boolean;
}> = {}) {
  return {
    id,
    title: overrides.title ?? `Chat ${id}`,
    createdMs: overrides.createdMs ?? 1000,
    updatedMs: overrides.updatedMs ?? 1000,
    projectId: overrides.projectId ?? null,
    gptId: overrides.gptId ?? null,
    pinned: overrides.pinned ?? false,
    archived: overrides.archived ?? false,
  };
}

export function listItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Chat ${id}`,
    create_time: "2024-01-01T00:00:00Z",
    update_time: "2024-01-01T00:00:00Z",
    conversation_template_id: null,
    gizmo_id: null,
    is_archived: false,
    pinned_time: null,
    is_starred: null,
    ...overrides,
  };
}
