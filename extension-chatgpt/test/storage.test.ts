import { describe, expect, it } from "vitest";
import { createJournal } from "../src/model.ts";
import { createChromeJournalStore, createMemoryJournalStore, decodeJournal, storageKey } from "../src/storage.ts";

describe("operation journal storage", () => {
  it("round-trips a journal with an in-flight run", async () => {
    const store = createMemoryJournalStore();
    const journal = createJournal("u1");
    journal.marks["a"] = { action: "delete", title: "Chat a", newTitle: null, project: "", projectName: "", at: 10 };
    journal.run = {
      id: "r1", status: "paused", phase: "write",
      jobs: [{ id: "a", action: "delete", newTitle: null, title: "Chat a", project: "", projectName: "", tries: 0 }],
      i: 0, results: [], startedAt: 0, owner: "owner-1", beat: 0, lastWriteAt: 0, nextAt: 0,
      fails: 0, note: "", current: "a", held: {}, backupCount: 0, backupFile: null,
      backupDownloaded: null, finishedAt: null,
    };
    await store.save(journal);
    const loaded = await store.load("u1");
    expect(loaded.marks["a"]?.action).toBe("delete");
    expect(loaded.run?.status).toBe("paused");
    expect(loaded.run?.current).toBe("a");
    expect(loaded.run?.jobs[0]?.id).toBe("a");
  });

  it("keeps accounts separate", async () => {
    const store = createMemoryJournalStore();
    const first = createJournal("u1");
    first.marks["a"] = { action: "archive", title: "Chat a", newTitle: null, project: "", projectName: "", at: 1 };
    await store.save(first);
    const second = await store.load("u2");
    expect(Object.keys(second.marks)).toEqual([]);
    expect((await store.load("u1")).marks["a"]?.action).toBe("archive");
  });

  it("falls back to a fresh journal for corrupt stored data", () => {
    const journal = decodeJournal({ accountId: "u1", marks: "not-an-object" }, "u1");
    expect(journal.marks).toEqual({});
    expect(journal.run).toBeNull();
    expect(journal.settings.gap).toBe(8);
  });

  it("uses an account-scoped key in Chrome storage", async () => {
    const values = new Map<string, unknown>();
    const storage = {
      local: {
        async get(key: string) {
          return { [key]: values.get(key) };
        },
        async set(entries: Record<string, unknown>) {
          for (const [key, value] of Object.entries(entries)) values.set(key, value);
        },
      },
    } as unknown as Pick<typeof chrome.storage, "local">;
    const store = createChromeJournalStore(storage);
    const journal = createJournal("u9");
    await store.save(journal);
    expect(values.has(storageKey("u9"))).toBe(true);
    expect((await store.load("u9")).accountId).toBe("u9");
  });
});
