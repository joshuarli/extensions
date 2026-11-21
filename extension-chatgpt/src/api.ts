import { TriageError } from "./errors.ts";
import {
  checkList,
  clamp,
  normalizeListItem,
  parseConversation,
  parseProjects,
  parseRetryAfter,
  type Chat,
  type Conversation,
  type Project,
} from "./model.ts";

export interface Config {
  pageSize: number;
  maxPages: number;
  requestGap: number;
  backupGap: number;
  gapDefault: number;
  gapMin: number;
  gapMax: number;
  cooldownLadder: number[];
  retryAfterMax: number;
  transientBackoff: number[];
  calmAfter: number;
  typeToConfirm: number;
  staleBeat: number;
}

export const CONFIG: Config = {
  pageSize: 100,
  maxPages: 200,
  requestGap: 1200,
  backupGap: 2500,
  gapDefault: 8,
  gapMin: 3,
  gapMax: 120,
  cooldownLadder: [2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000],
  retryAfterMax: 60 * 60_000,
  transientBackoff: [5_000, 15_000, 45_000],
  calmAfter: 10,
  typeToConfirm: 20,
  staleBeat: 20_000,
};

export interface ApiState {
  token: string | null;
  accountId: string | null;
  lastAt: number;
  calm: number;
  cooldownUntil: number;
  strikes: number;
}

export function createApiState(): ApiState {
  return { token: null, accountId: null, lastAt: 0, calm: 0, cooldownUntil: 0, strikes: 0 };
}

export function scaled(ms: number, scale: number): number {
  return Math.round(ms * scale);
}

export function computeCooldownMs(
  strikes: number,
  hintedMs: number | null,
  config: Config,
  scale: number,
  _nowMs: number,
): number {
  if (hintedMs != null) {
    return clamp(hintedMs + 1000, 1000, config.retryAfterMax);
  }
  const index = Math.min(strikes, config.cooldownLadder.length - 1);
  return scaled(config.cooldownLadder[index] ?? config.cooldownLadder[config.cooldownLadder.length - 1] ?? 0, scale);
}

export interface NetworkRecord {
  at: number;
  method: string;
  path: string;
  status: number | string;
  ms: number;
}

export interface ApiDeps {
  fetch: typeof globalThis.fetch;
  state: ApiState;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  config?: Config;
  scale?: number;
  onNetwork?: (record: NetworkRecord) => void;
  onCooldown?: () => void;
}

export interface Session {
  accessToken: string;
  userId: string | null;
}

export interface ApiClient {
  session(): Promise<Session>;
  list(scope: "active" | "archived", onProgress?: (found: number, total: number | null, waiting: boolean) => void): Promise<Chat[]>;
  projects(): Promise<Project[]>;
  conversation(id: string): Promise<Conversation>;
  detail(id: string): Promise<unknown>;
  change(id: string, body: Record<string, string | boolean>): Promise<void>;
  cooldownLeft(): number;
  log(): NetworkRecord[];
}

export function createApiClient(deps: ApiDeps): ApiClient {
  const config = deps.config ?? CONFIG;
  const scale = deps.scale ?? 1;
  const { state } = deps;
  const log: NetworkRecord[] = [];

  function record(method: string, path: string, status: number | string, ms: number): void {
    log.push({ at: deps.now(), method, path, status, ms });
    if (log.length > 400) log.shift();
    deps.onNetwork?.(log[log.length - 1] as NetworkRecord);
  }

  function cooldownLeft(): number {
    return Math.max(0, state.cooldownUntil - deps.now());
  }

  function cooling(): void {
    if (cooldownLeft() > 0) {
      throw new TriageError("cooldown", "ChatGPT asked Triage to slow down.", state.cooldownUntil);
    }
  }

  async function waitForCooldown(signal?: AbortSignal): Promise<void> {
    while (cooldownLeft() > 0) {
      await deps.sleep(Math.min(1000, cooldownLeft()), signal);
    }
  }

  async function sessionRequest(): Promise<Session> {
    let response: Response;
    try {
      response = await deps.fetch("/api/auth/session", { credentials: "include" });
    } catch {
      throw new TriageError("offline", "Couldn't reach ChatGPT. Check your connection, then reload the page.");
    }
    record("GET", "/api/auth/session", response.status, 0);
    if (!response.ok) {
      throw new TriageError("auth", `ChatGPT didn't return a session (HTTP ${response.status}). Make sure you're signed in.`);
    }
    const data = await response.json().catch(() => null) as { accessToken?: unknown; user?: { id?: unknown } } | null;
    if (!data || typeof data.accessToken !== "string" || !data.accessToken) {
      throw new TriageError("auth", "You don't seem to be signed in. Sign in at chatgpt.com, then try again.");
    }
    const accountId = typeof data.user?.id === "string" ? data.user.id : null;
    if (state.accountId != null && accountId !== state.accountId) {
      throw new TriageError("auth", "The signed-in ChatGPT account changed during a run. Reload the dashboard before making more changes.");
    }
    state.token = data.accessToken;
    state.accountId = accountId;
    return { accessToken: data.accessToken, userId: accountId };
  }

  async function request(method: string, path: string, body?: Record<string, string | boolean>, retryAuth = true): Promise<unknown> {
    cooling();
    const slot = Math.max(deps.now(), state.lastAt + scaled(config.requestGap, scale));
    state.lastAt = slot;
    if (slot > deps.now()) await deps.sleep(slot - deps.now());
    cooling();

    const headers: Record<string, string> = { Authorization: `Bearer ${state.token ?? ""}` };
    if (body) headers["Content-Type"] = "application/json";
    const started = deps.now();
    let response: Response;
    try {
      response = await deps.fetch(path, {
        method,
        headers,
        credentials: "include",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      record(method, path, "network error", deps.now() - started);
      throw new TriageError("transient", "Network error.");
    }
    record(method, path, response.status, deps.now() - started);

    if (response.status === 429) {
      const hint = parseRetryAfter(response.headers.get("retry-after"), deps.now());
      const wait = computeCooldownMs(state.strikes, hint, config, scale, deps.now());
      state.strikes += 1;
      state.calm = 0;
      state.cooldownUntil = Math.max(state.cooldownUntil, deps.now() + wait);
      deps.onCooldown?.();
      throw new TriageError("ratelimit", "ChatGPT said: too many requests.", state.cooldownUntil);
    }
    if ((response.status === 401 || response.status === 403) && retryAuth) {
      await sessionRequest();
      return request(method, path, body, false);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TriageError("auth", `ChatGPT refused the request (HTTP ${response.status}). Check that you're signed in.`);
    }
    if (response.status === 404) throw new TriageError("notfound", "Chat not found.");
    if (response.status >= 500) throw new TriageError("transient", `ChatGPT had a server error (HTTP ${response.status}).`);

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data
        ? `: ${String((data as { detail: unknown }).detail).slice(0, 140)}`
        : "";
      throw new TriageError("http", `HTTP ${response.status}${detail}`);
    }
    if (data && typeof data === "object" && "success" in data && (data as { success: unknown }).success === false) {
      throw new TriageError("http", "ChatGPT said the change didn't go through.");
    }
    state.calm += 1;
    if (state.calm >= config.calmAfter && state.strikes) state.strikes = 0;
    return data;
  }

  async function listWithRetry(
    path: string,
    onProgress?: (found: number, total: number | null, waiting: boolean) => void,
  ): Promise<{ items: unknown[]; total: number | null }> {
    const found = new Map<string, unknown>();
    let offset = 0;
    let total: number | null = null;
    let tries = 0;
    for (let page = 0; page < config.maxPages; page += 1) {
      let data: unknown;
      try {
        data = await request("GET", path.replace("{offset}", String(offset)).replace("{limit}", String(config.pageSize)));
      } catch (error) {
        const failure = error instanceof TriageError ? error : null;
        if (failure && (failure.kind === "ratelimit" || failure.kind === "cooldown")) {
          onProgress?.(found.size, total, true);
          await waitForCooldown();
          page -= 1;
          continue;
        }
        if (failure && failure.kind === "transient" && tries < config.transientBackoff.length) {
          await deps.sleep(scaled(config.transientBackoff[tries] ?? 0, scale));
          tries += 1;
          page -= 1;
          continue;
        }
        throw error;
      }
      tries = 0;
      const checked = checkList(data);
      const before = found.size;
      for (const item of checked.items) {
        const row = item as { id: string };
        found.set(row.id, item);
      }
      if (checked.total != null) total = checked.total;
      onProgress?.(found.size, total, false);
      if (!checked.items.length || found.size === before) break;
      offset += checked.items.length;
    }
    return { items: [...found.values()], total };
  }

  return {
    async session() {
      return sessionRequest();
    },
    async list(scope, onProgress) {
      const archived = scope === "archived" ? "&is_archived=true" : "";
      const { items } = await listWithRetry(`/backend-api/conversations?offset={offset}&limit={limit}&order=updated${archived}`, onProgress);
      const chats: Chat[] = [];
      let compatible = true;
      for (const item of items) {
        const chat = normalizeListItem(item, scope === "archived");
        if (chat) chats.push(chat);
        else compatible = false;
      }
      if (!compatible) throw new TriageError("compat", "ChatGPT's chat list looks different from what Triage expects, so Triage stopped.");
      return chats;
    },
    async projects() {
      const found = new Map<string, Project>();
      let cursor: string | null = null;
      let tries = 0;
      for (let page = 0; page < 20; page += 1) {
        const query = `conversations_per_gizmo=0&limit=20&owned_only=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        let data: unknown;
        try {
          data = await request("GET", `/backend-api/gizmos/snorlax/sidebar?${query}`);
        } catch (error) {
          const failure = error instanceof TriageError ? error : null;
          if (failure && (failure.kind === "ratelimit" || failure.kind === "cooldown")) {
            await waitForCooldown();
            page -= 1;
            continue;
          }
          if (failure && failure.kind === "transient" && tries < config.transientBackoff.length) {
            await deps.sleep(scaled(config.transientBackoff[tries] ?? 0, scale));
            tries += 1;
            page -= 1;
            continue;
          }
          throw error;
        }
        tries = 0;
        if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) {
          throw new TriageError("compat", "ChatGPT's project list looks different from what Triage expects, so moving chats is switched off.");
        }
        for (const project of parseProjects(data)) found.set(project.id, project);
        cursor = typeof (data as { cursor?: unknown }).cursor === "string" ? (data as { cursor: string }).cursor : null;
        if (!cursor || !(data as { items: unknown[] }).items.length) break;
      }
      return [...found.values()];
    },
    async conversation(id) {
      const data = await request("GET", `/backend-api/conversation/${encodeURIComponent(id)}`);
      return parseConversation(data);
    },
    async detail(id) {
      return request("GET", `/backend-api/conversation/${encodeURIComponent(id)}`);
    },
    async change(id, body) {
      await request("PATCH", `/backend-api/conversation/${encodeURIComponent(id)}`, body);
    },
    cooldownLeft,
    log() {
      return [...log];
    },
  };
}
