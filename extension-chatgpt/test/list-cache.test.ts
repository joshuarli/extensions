import { describe, expect, it } from "vitest";
import { createMemoryListCacheStore, listCacheKey, type CachedList } from "../src/list-cache.ts";
import { normalizeListItem } from "../src/model.ts";
import { listItem } from "./helpers.ts";

const snapshot = (accountId = "u1"): CachedList => ({
  version: 1,
  accountId,
  savedAt: 1234,
  chats: [normalizeListItem(listItem("c1"), false)],
  complete: true,
  total: 1,
  projects: [{ id: "g-p-work", name: "Work" }],
});

describe("ChatGPT list cache", () => {
  it("round-trips a snapshot scoped to its account", async () => {
    const store = createMemoryListCacheStore();
    await store.save(snapshot());
    expect(await store.load("u1")).toEqual(snapshot());
    expect(await store.load("u2")).toBeNull();
  });

  it("treats malformed or unknown-version data as a miss", async () => {
    const key = listCacheKey("u1");
    expect(await createMemoryListCacheStore({ [key]: { ...snapshot(), version: 2 } }).load("u1")).toBeNull();
    expect(await createMemoryListCacheStore({ [key]: { nope: true } }).load("u1")).toBeNull();
  });

  it("clears only the named account", async () => {
    const store = createMemoryListCacheStore();
    await store.save(snapshot("u1"));
    await store.save(snapshot("u2"));
    await store.clear("u1");
    expect(await store.load("u1")).toBeNull();
    expect(await store.load("u2")).not.toBeNull();
  });
});
