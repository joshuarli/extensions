import type { ArchiveDeps, ChatgptTransport } from "../src/index.ts";

export interface TransportCall {
  path: string;
  headers?: Record<string, string>;
}

export class FakeTransport implements ChatgptTransport {
  readonly calls: TransportCall[] = [];
  private readonly routes = new Map<string, unknown[]>();

  add(path: string, ...responses: unknown[]): this {
    this.routes.set(path, responses);
    return this;
  }

  async getJson(path: string, headers?: Record<string, string>): Promise<unknown> {
    this.calls.push(headers === undefined ? { path } : { path, headers });
    const queue = this.routes.get(path);
    if (queue === undefined || queue.length === 0) throw new Error("Unexpected request: " + path);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  }
}

export function makeDeps(transport: ChatgptTransport, gap?: number, nowMs = 0): {
  deps: ArchiveDeps;
  sleepCalls: number[];
} {
  const sleepCalls: number[] = [];
  const deps: ArchiveDeps = {
    transport,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    now: () => nowMs,
  };
  if (gap !== undefined) deps.requestGapMs = gap;
  return { deps, sleepCalls };
}

export function row(id: string, createdSeconds: number, updateSeconds: number, archived = false): unknown {
  return {
    id,
    title: "Chat " + id,
    create_time: createdSeconds,
    update_time: updateSeconds,
    is_archived: archived,
  };
}

export function page(items: unknown[], total: number): unknown {
  return { items, total };
}

export const ACTIVE_PAGE_0 = "/backend-api/conversations?offset=0&limit=100&order=updated";
export const ARCHIVED_PAGE_0 = "/backend-api/conversations?offset=0&limit=100&order=updated&is_archived=true";
