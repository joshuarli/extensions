import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suiteExtensionPath } from "../../lib/assets.ts";
import { seedFromHelium, seedMergeCounts } from "../src/seed.ts";

const userId = "123";
const savedState = process.env["X_ARCHIVE_STATE"];
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "x-archive-seed-test-"));
  process.env["X_ARCHIVE_STATE"] = root;
});

afterEach(() => {
  if (savedState === undefined) delete process.env["X_ARCHIVE_STATE"];
  else process.env["X_ARCHIVE_STATE"] = savedState;
  rmSync(root, { recursive: true, force: true });
});

function missingStoreFactory(): IDBFactory {
  const db = {
    close: () => {},
    transaction: () => {
      throw new DOMException("One of the specified object stores was not found", "NotFoundError");
    },
  };
  return {
    open: () => {
      const request: { onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; result: unknown } = {
        result: db,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
}

describe("legacy seeding counts", () => {
  it("counts new and existing tweet ids regardless of archive size", () => {
    expect(seedMergeCounts(
      [{ tweet_id: "1" }, { tweet_id: "2" }],
      [{ tweet_id: "2" }, { tweet_id: "3" }],
    )).toEqual({ added: 1, updated: 1 });
    expect(seedMergeCounts([{ tweet_id: "1" }, { tweet_id: "2" }], [])).toEqual({ added: 0, updated: 0 });
  });
});

describe("legacy extension seeding", () => {
  it("completes when an IndexedDB database lacks the expected object stores", async () => {
    const worker = {
      url: () => "chrome-extension://suite/sw.js",
      evaluate: vi.fn(async (fn: (accountId: string) => Promise<unknown>, accountId: string) => {
        const globals = globalThis as { indexedDB: IDBFactory | undefined };
        const previous = globals.indexedDB;
        globals.indexedDB = missingStoreFactory();
        try {
          return await fn(accountId);
        } finally {
          globals.indexedDB = previous;
        }
      }),
    };
    const session = {
      send: vi.fn(async (method: string) => method === "Extensions.getExtensions"
        ? { extensions: [{ id: "suite", path: suiteExtensionPath({}), enabled: true }] }
        : {}),
    };
    const browser = {
      newBrowserCDPSession: vi.fn(async () => session),
      contexts: () => [{ serviceWorkers: () => [worker] }],
      close: vi.fn(async () => {}),
    };
    const connect = vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(browser as never);
    const profileStore = {
      allRecords: vi.fn(async () => []),
      loadState: vi.fn(async () => null),
      savePage: vi.fn(async () => {}),
      saveState: vi.fn(async () => {}),
    };
    try {
      const report = await Promise.race([
        seedFromHelium({ userId, cookies: [] }, "http://127.0.0.1:9222", {
          onlyProfileTarget: "999",
          profileStore: profileStore as never,
        }),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("seedFromHelium hung")), 2000)),
      ]);
      expect(report.bookmarks.records).toBe(0);
      expect(report.likes.records).toBe(0);
      expect(report.profiles).toEqual([]);
    } finally {
      connect.mockRestore();
    }
  });
});
