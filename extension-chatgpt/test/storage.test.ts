import { describe, expect, it } from "vitest";
import { createJournal } from "../src/model.ts";
import { TriageError } from "../src/errors.ts";
import { createChromeJournalStore, createMemoryJournalStore, createSerialPersist, decodeJournal, storageKey } from "../src/storage.ts";

describe("operation journal storage", () => {
  it("round-trips a journal with an in-flight run", async () => {
    const store = createMemoryJournalStore();
    const journal = createJournal("u1");
    journal.marks["a"] = { action: "delete", title: "Chat a", newTitle: null, project: "", projectName: "", at: 10 };
    journal.run = {
      id: "r1", accountId: "u1", status: "paused", phase: "write",
      jobs: [{ id: "a", action: "delete", newTitle: null, title: "Chat a", project: "", projectName: "", tries: 0 }],
      i: 0, results: [], startedAt: 0, lastWriteAt: 0, nextAt: 0,
      fails: 0, note: "", inflight: { id: "a", sentAt: 5, outcome: "sent" }, held: {},
      backup: { required: true, acceptIncomplete: false, saved: { file: "b.json", sha256: "ab", ids: ["a"], verification: "file", at: 4 } },
      finishedAt: null,
    };
    await store.save(journal);
    const loaded = await store.load("u1");
    expect(loaded.marks["a"]?.action).toBe("delete");
    expect(loaded.run?.status).toBe("paused");
    expect(loaded.run?.inflight).toEqual({ id: "a", sentAt: 5, outcome: "sent" });
    expect(loaded.run?.backup.saved?.ids).toEqual(["a"]);
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

  it("fails closed instead of replacing an unreadable journal", () => {
    expect(() => decodeJournal({ accountId: "u1", marks: "not-an-object" }, "u1")).toThrow(TriageError);
    expect(() => decodeJournal({ ...createJournal("u2") }, "u1")).toThrow(/different account/u);
    expect(decodeJournal(undefined, "u1").run).toBeNull();
  });

  it("writes in call order, each write holding the journal as it was when requested", async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const journal = createJournal("u1");
    const persist = createSerialPersist({
      async load() { return journal; },
      save(saved) {
        return new Promise<void>((resolve) => {
          release.push(() => {
            order.push(Object.keys(saved.marks).join(","));
            resolve();
          });
        });
      },
    }, () => journal);
    journal.marks["a"] = { action: "delete", title: "a", newTitle: null, project: "", projectName: "", at: 0 };
    const first = persist();
    journal.marks["b"] = { action: "delete", title: "b", newTitle: null, project: "", projectName: "", at: 0 };
    const second = persist();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(release).toHaveLength(1);
    release[0]?.();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    release[1]?.();
    await second;
    expect(order).toEqual(["a", "a,b"]);
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
