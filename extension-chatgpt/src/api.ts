import { Option, Schema } from "effect";
import { TriageError } from "./errors.ts";
import {
  checkList,
  clamp,
  normalizeListItem,
  parseConversation,
  parseProjects,
  parseRetryAfter,
  probeFromDetail,
  requestBodyFor,
  type Chat,
  type Command,
  type Conversation,
  type ConversationProbe,
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

// The bearer token never leaves the client; callers only learn which account is signed in.
export interface Session {
  accountId: string | null;
}

interface ReadRequest {
  path: string;
  accountId: string;
}

interface Mutation {
  accountId: string;
  authorize(): Command;
}

const AuthSessionSchema = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  user: Schema.Struct({ id: Schema.NonEmptyString }),
});
const NotFoundSchema = Schema.Struct({ detail: Schema.Literal("conversation_not_found") });
const AcknowledgementSchema = Schema.Struct({ success: Schema.Boolean });
const decodeAuthSession = Schema.decodeUnknownSync(AuthSessionSchema);
const decodeAcknowledgement = Schema.decodeUnknownOption(AcknowledgementSchema, { onExcessProperty: "error" });

export interface ChatList {
  chats: Chat[];
  complete: boolean;
  total: number | null;
}

export interface ApiClient {
  session(): Promise<Session>;
  list(accountId: string, scope: "active" | "archived", onProgress?: (found: number, total: number | null, waiting: boolean) => void): Promise<ChatList>;
  projects(accountId: string): Promise<Project[]>;
  conversation(accountId: string, id: string): Promise<Conversation>;
  record(accountId: string, id: string): Promise<unknown>;
  probe(accountId: string, id: string): Promise<ConversationProbe>;
  change(mutation: Mutation): Promise<void>;
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

  async function sessionRequest(expectedAccount?: string): Promise<{ accountId: string; token: string }> {
    let response: Response;
    try {
      response = await deps.fetch("/api/auth/session", { credentials: "include", cache: "no-store", redirect: "error" });
    } catch {
      throw new TriageError("offline", "Couldn't reach ChatGPT. Check your connection, then reload the page.");
    }
    record("GET", "/api/auth/session", response.status, 0);
    if (!response.ok || response.redirected) {
      throw new TriageError("auth", `ChatGPT didn't return a session (HTTP ${response.status}). Make sure you're signed in.`);
    }
    let data: Schema.Schema.Type<typeof AuthSessionSchema>;
    try {
      data = decodeAuthSession(await response.json());
    } catch {
      throw new TriageError("auth", "Couldn't identify the signed-in ChatGPT account. Sign in at chatgpt.com, then try again.");
    }
    const accountId = data.user.id;
    if (accountId !== (expectedAccount ?? state.accountId ?? accountId)) {
      state.token = null;
      state.accountId = null;
      throw new TriageError("auth", "The signed-in ChatGPT account changed during a run. Reload the dashboard before making more changes.");
    }
    state.token = data.accessToken;
    state.accountId = accountId;
    return { accountId, token: data.accessToken };
  }

  async function request(target: ReadRequest | Mutation, retryAuth = true): Promise<unknown> {
    cooling();
    const slot = Math.max(deps.now(), state.lastAt + scaled(config.requestGap, scale));
    state.lastAt = slot;
    if (slot > deps.now()) await deps.sleep(slot - deps.now());
    cooling();

    const mutation = "authorize" in target;
    const method = mutation ? "PATCH" : "GET";
    let token = state.token ?? "";
    if (mutation) {
      try {
        ({ token } = await sessionRequest(target.accountId));
      } catch (error) {
        const message = error instanceof TriageError ? error.message : "Couldn't validate the signed-in account.";
        throw new TriageError("auth", `${message} No change was sent.`);
      }
      cooling();
    } else if (state.accountId !== target.accountId || !token) {
      throw new TriageError("auth", "The current account no longer matches this read.");
    }
    let path: string;
    let body: Record<string, string | boolean> | null = null;
    if ("path" in target) {
      path = target.path;
    } else {
      const command = target.authorize();
      path = `/backend-api/conversation/${encodeURIComponent(command.id)}`;
      body = requestBodyFor(command);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body) headers["Content-Type"] = "application/json";
    const started = deps.now();
    let response: Response;
    try {
      response = await deps.fetch(path, {
        method,
        headers,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      record(method, path, "network error", deps.now() - started);
      throw new TriageError("transient", "Network error.");
    }
    record(method, path, response.status, deps.now() - started);

    if (mutation && (response.redirected || (response.status >= 300 && response.status < 400))) {
      throw new TriageError("transient", "ChatGPT redirected the change request.");
    }
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
      if (!mutation) await sessionRequest(target.accountId);
      return request(target, false);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TriageError("auth", `ChatGPT refused the request (HTTP ${response.status}). Check that you're signed in.`);
    }
    if (response.status >= 500) throw new TriageError("transient", `ChatGPT had a server error (HTTP ${response.status}).`);

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new TriageError("transient", `ChatGPT's response (HTTP ${response.status}) was cut off.`);
    }
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (response.status === 404 && path.startsWith("/backend-api/conversation/")) {
      if (contentType === "application/json" && Schema.is(NotFoundSchema)(data)) {
        throw new TriageError("notfound", "Chat not found.");
      }
      throw new TriageError("transient", "ChatGPT returned an unfamiliar response for this chat.");
    }
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data
        ? `: ${String((data as { detail: unknown }).detail).slice(0, 140)}`
        : "";
      throw new TriageError("http", `HTTP ${response.status}${detail}`);
    }
    if (mutation) {
      const acknowledgement = response.status === 200 && contentType === "application/json"
        ? Option.getOrNull(decodeAcknowledgement(data))
        : null;
      if (!acknowledgement) throw new TriageError("transient", "ChatGPT returned an unfamiliar change acknowledgement.");
      if (!acknowledgement.success) throw new TriageError("http", "ChatGPT said the change didn't go through.");
    }
    state.calm += 1;
    if (state.calm >= config.calmAfter && state.strikes) state.strikes = 0;
    return data;
  }

  async function listWithRetry(
    accountId: string,
    path: string,
    onProgress?: (found: number, total: number | null, waiting: boolean) => void,
  ): Promise<{ items: Record<string, unknown>[]; total: number | null; complete: boolean }> {
    const found = new Map<string, Record<string, unknown>>();
    let offset = 0;
    let total: number | null = null;
    let tries = 0;
    let exhausted = false;
    let stalled = false;
    for (let page = 0; page < config.maxPages; page += 1) {
      let data: unknown;
      try {
        data = await request({ path: path.replace("{offset}", String(offset)).replace("{limit}", String(config.pageSize)), accountId });
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
      for (const item of checked.items) found.set(String(item["id"]), item);
      if (checked.total != null) total = checked.total;
      onProgress?.(found.size, total, false);
      if (!checked.items.length) {
        exhausted = true;
        break;
      }
      if (found.size === before) {
        stalled = true;
        break;
      }
      offset += checked.items.length;
    }
    const complete = exhausted && !stalled && (total == null || found.size >= total);
    return { items: [...found.values()], total, complete };
  }

  return {
    async session() {
      const { accountId } = await sessionRequest();
      return { accountId };
    },
    async list(accountId, scope, onProgress) {
      const archived = scope === "archived" ? "&is_archived=true" : "";
      const { items, total, complete } = await listWithRetry(accountId, `/backend-api/conversations?offset={offset}&limit={limit}&order=updated${archived}`, onProgress);
      return { chats: items.map((item) => normalizeListItem(item, scope === "archived")), complete, total };
    },
    async projects(accountId) {
      const found = new Map<string, Project>();
      let cursor: string | null = null;
      let tries = 0;
      for (let page = 0; page < 20; page += 1) {
        const query = `conversations_per_gizmo=0&limit=20&owned_only=false${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        let data: unknown;
        try {
          data = await request({ path: `/backend-api/gizmos/snorlax/sidebar?${query}`, accountId });
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
    async conversation(accountId, id) {
      const data = await request({ path: `/backend-api/conversation/${encodeURIComponent(id)}`, accountId });
      return parseConversation(data);
    },
    async record(accountId, id) {
      return request({ path: `/backend-api/conversation/${encodeURIComponent(id)}`, accountId });
    },
    async probe(accountId, id) {
      return probeFromDetail(await request({ path: `/backend-api/conversation/${encodeURIComponent(id)}`, accountId }));
    },
    async change(mutation) {
      await request(mutation);
    },
    cooldownLeft,
    log() {
      return [...log];
    },
  };
}
