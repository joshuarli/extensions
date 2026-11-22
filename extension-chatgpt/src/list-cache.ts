import { Schema } from "effect";
import { ChatSchema, ProjectListSchema } from "./messages.ts";
import type { Chat, Project } from "./model.ts";

const CachedListSchema = Schema.Struct({
  version: Schema.Literal(1),
  accountId: Schema.String,
  savedAt: Schema.Number,
  chats: Schema.Array(ChatSchema),
  complete: Schema.Boolean,
  total: Schema.Union([Schema.Number, Schema.Null]),
  projects: ProjectListSchema,
});

export interface CachedList {
  version: 1;
  accountId: string;
  savedAt: number;
  chats: Chat[];
  complete: boolean;
  total: number | null;
  projects: Project[];
}

export interface ListCacheStore {
  load(accountId: string): Promise<CachedList | null>;
  save(snapshot: CachedList): Promise<void>;
  clear(accountId: string): Promise<void>;
}

export function listCacheKey(accountId: string): string {
  return `chatgpt-organizer:v1:list:${accountId}`;
}

function decodeCachedList(value: unknown, accountId: string): CachedList | null {
  if (value == null) return null;
  try {
    const decoded = Schema.decodeUnknownSync(CachedListSchema, { onExcessProperty: "error" })(value);
    return decoded.accountId === accountId
      ? {
          ...decoded,
          chats: decoded.chats.map((chat) => ({ ...chat })),
          projects: decoded.projects.map((project) => ({ ...project })),
        }
      : null;
  } catch {
    return null;
  }
}

export function createChromeListCacheStore(storage: Pick<typeof chrome.storage, "local">): ListCacheStore {
  return {
    async load(accountId) {
      const key = listCacheKey(accountId);
      const result = await storage.local.get(key);
      return decodeCachedList(result[key], accountId);
    },
    async save(snapshot) {
      await storage.local.set({ [listCacheKey(snapshot.accountId)]: snapshot });
    },
    async clear(accountId) {
      await storage.local.remove(listCacheKey(accountId));
    },
  };
}

export function createMemoryListCacheStore(seed: Record<string, unknown> = {}): ListCacheStore {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    async load(accountId) {
      return decodeCachedList(values.get(listCacheKey(accountId)), accountId);
    },
    async save(snapshot) {
      values.set(listCacheKey(snapshot.accountId), structuredClone(snapshot));
    },
    async clear(accountId) {
      values.delete(listCacheKey(accountId));
    },
  };
}
