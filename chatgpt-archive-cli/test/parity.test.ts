import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatgptArchive } from "../../chatgpt-archive-core/src/index.ts";
import type { DownloadOptions } from "../src/args.ts";
import { runDownload } from "../src/download.ts";
import { archiveDir } from "../src/state.ts";
import { splitLines } from "../src/storage.ts";
import { chat, createFakeArchive, createMemoryFs, createReporter, lineFor } from "./fakes.ts";

const DAY_ONE = Date.parse("2026-11-22T10:30:00Z");
const DAY_TWO = Date.parse("2026-11-23T08:00:00Z");
const OUT = "/downloads";
const DIR = archiveDir(OUT, "account-1");
const RECORDS = join(DIR, "records.jsonl");
const MANIFEST = join(DIR, "manifest.json");
const STATE = join(DIR, "state.json");
const MEDIA_PATH = "/backend-api/files/file-img-1/download";

function options(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    since: null,
    until: null,
    sinceMs: null,
    untilMs: null,
    timeField: "updated",
    outRoot: OUT,
    includeArchived: false,
    noMedia: true,
    maxMediaBytes: 16 * 1024 * 1024,
    limit: null,
    backend: undefined,
    session: undefined,
    cdpUrl: undefined,
    ...overrides,
  };
}

function ids(fs: { files: Map<string, string> }): string[] {
  return splitLines(fs.files.get(RECORDS) ?? "").map((line) => (JSON.parse(line) as { id: string }).id);
}

describe("checkpointed resume", () => {
  it("stops listing at the first covered page once a scan is complete", async () => {
    const chats = [
      chat("a", "Alpha", 100, 400),
      chat("b", "Bravo", 200, 300),
      chat("c", "Charlie", 300, 200),
      chat("d", "Delta", 400, 100),
    ];
    const pages = chats.map((entry) => [entry]);
    const base = createFakeArchive({ pages: { active: pages } });
    const fs = createMemoryFs();
    const first = await runDownload(
      { options: options() },
      { archive: base, fs, reporter: createReporter(), now: () => DAY_ONE },
    );
    expect(first.written).toBe(4);

    let listedPages = 0;
    let recordCalls = 0;
    const tracked: ChatgptArchive = {
      ...base,
      async list(scope, onPage) {
        return base.list(scope, (page, total) => {
          listedPages++;
          return onPage?.(page, total);
        });
      },
      async record(id) {
        recordCalls++;
        return base.record(id);
      },
    };
    const second = await runDownload(
      { options: options() },
      { archive: tracked, fs, reporter: createReporter(), now: () => DAY_TWO },
    );
    expect(second).toMatchObject({ written: 0, skipped: 1, total: 4, stopped: false });
    expect(ids(fs)).toEqual(["a", "b", "c", "d"]);
    expect(listedPages).toBe(1);
    expect(recordCalls).toBe(0);
    expect(fs.files.get(STATE)).toContain('"complete": true');
  });

  it("does not treat a limited run as caught up until it has saved every listed chat", async () => {
    const chats = [
      chat("a", "Alpha", 100, 400),
      chat("b", "Bravo", 200, 300),
      chat("c", "Charlie", 300, 200),
    ];
    const pages = chats.map((entry) => [entry]);
    const archive = createFakeArchive({ pages: { active: pages } });
    const fs = createMemoryFs();
    const first = await runDownload(
      { options: options({ limit: 1 }) },
      { archive, fs, reporter: createReporter(), now: () => DAY_ONE },
    );
    expect(first.written).toBe(1);
    expect(fs.files.get(STATE)).toContain('"complete": false');

    const second = await runDownload(
      { options: options() },
      { archive, fs, reporter: createReporter(), now: () => DAY_TWO },
    );
    expect(second).toMatchObject({ written: 2, total: 3 });
    expect(ids(fs)).toEqual(["a", "b", "c"]);
    expect(fs.files.get(STATE)).toContain('"complete": true');
  });

  it("refreshes a changed chat by appending a newer line without losing the old one", async () => {
    const fs = createMemoryFs();
    const first = await runDownload(
      { options: options() },
      { archive: createFakeArchive({ active: [chat("a", "Alpha", 100, 300)] }), fs, reporter: createReporter(), now: () => DAY_ONE },
    );
    expect(first.written).toBe(1);

    const second = await runDownload(
      { options: options() },
      { archive: createFakeArchive({ active: [chat("a", "Renamed", 100, 400)] }), fs, reporter: createReporter(), now: () => DAY_TWO },
    );
    expect(second).toMatchObject({ written: 1, refreshed: 1, total: 1 });
    expect(ids(fs)).toEqual(["a", "a"]);
    expect(splitLines(fs.files.get(RECORDS)!).at(-1)).toContain('"title":"Renamed"');
    expect(fs.files.get(MANIFEST)).toContain('"total": 1');
  });

  it("resumes in the same account folder on a later day and imports legacy day folders", async () => {
    const fs = createMemoryFs({
      [join(OUT, "chatgpt-2026-11-20", "records.jsonl")]: lineFor("old", "Old", 1, 1) + "\n",
    });
    fs.dirs.add(join(OUT, "chatgpt-2026-11-20"));
    const chats = [chat("a", "Alpha", 100, 100), chat("b", "Bravo", 200, 200)];
    const first = await runDownload(
      { options: options({ limit: 1 }) },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => DAY_ONE },
    );
    const second = await runDownload(
      { options: options({ limit: 1 }) },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => DAY_TWO },
    );
    expect(first.outputDir).toBe(DIR);
    expect(second.outputDir).toBe(DIR);
    expect(ids(fs)).toEqual(["old", "a", "b"]);
    expect(second).toMatchObject({ written: 1, skipped: 1, total: 3 });
  });

  it("fails loudly when the saved state belongs to another account", async () => {
    const fs = createMemoryFs({
      [STATE]: JSON.stringify({
        format: "chatgpt-archive-state",
        version: 1,
        accountId: "someone-else",
        scopes: {
          active: { complete: false, scanned: 0 },
          archived: { complete: false, scanned: 0 },
        },
      }),
    });
    await expect(runDownload(
      { options: options() },
      { archive: createFakeArchive({ active: [chat("a", "Alpha", 1)] }), fs, reporter: createReporter(), now: () => DAY_ONE },
    )).rejects.toThrow("belongs to another account");
  });
});

describe("cooperative interruption", () => {
  it("writes the manifest from saved records and stops before the next record", async () => {
    const controller = new AbortController();
    let calls = 0;
    const base = createFakeArchive({
      active: [chat("a", "Alpha", 100, 100), chat("b", "Bravo", 200, 200)],
    });
    const archive: ChatgptArchive = {
      ...base,
      async record(id) {
        calls++;
        if (calls === 1) controller.abort();
        return base.record(id);
      },
    };
    const fs = createMemoryFs();
    const summary = await runDownload(
      { options: options() },
      { archive, fs, reporter: createReporter(), now: () => DAY_ONE, signal: controller.signal },
    );
    expect(summary.stopped).toBe(true);
    expect(summary.written).toBe(1);
    expect(ids(fs)).toEqual(["a"]);
    expect(calls).toBe(1);
    expect(fs.files.get(MANIFEST)).toContain('"total": 1');
    expect(fs.files.get(STATE)).toContain('"complete": false');
  });

  it("starts nothing when interrupted before the run", async () => {
    const controller = new AbortController();
    controller.abort();
    const fs = createMemoryFs();
    await expect(runDownload(
      { options: options() },
      {
        archive: createFakeArchive({ active: [chat("a", "Alpha", 100)] }),
        fs,
        reporter: createReporter(),
        now: () => DAY_ONE,
        signal: controller.signal,
      },
    )).rejects.toThrow("Stopped");
    expect(fs.files.size).toBe(0);
  });

  it("leaves no part or final media file when interrupted during a download", async () => {
    const controller = new AbortController();
    const record = {
      mapping: {
        n1: {
          message: {
            content: {
              content_type: "multimodal_text",
              parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://file-img-1" }],
            },
          },
        },
      },
    };
    const fs = createMemoryFs();
    const summary = await runDownload(
      { options: options({ noMedia: false }) },
      {
        archive: createFakeArchive({
          active: [chat("a", "Alpha", 100)],
          records: { a: record },
          mediaHandler: async () => {
            controller.abort();
            return new Uint8Array([1, 2, 3]);
          },
        }),
        fs,
        reporter: createReporter(),
        now: () => DAY_ONE,
        signal: controller.signal,
      },
    );
    expect(summary.stopped).toBe(true);
    expect(fs.bytes.size).toBe(0);
    expect(fs.renames).toEqual([]);
    expect(fs.files.get(MANIFEST)).toContain('"media"');
  });
});

describe("media size limit", () => {
  const record = {
    mapping: {
      n1: {
        message: {
          content: {
            content_type: "multimodal_text",
            parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://file-img-1" }],
          },
        },
      },
    },
  };
  const media = { [MEDIA_PATH]: new Uint8Array(100).fill(7) };

  it("skips oversized media, records the id, and fetches it on a later run with a larger limit", async () => {
    const fs = createMemoryFs();
    const first = await runDownload(
      { options: options({ noMedia: false, maxMediaBytes: 10 }) },
      {
        archive: createFakeArchive({ active: [chat("a", "Alpha", 100)], records: { a: record }, media }),
        fs,
        reporter: createReporter(),
        now: () => DAY_ONE,
      },
    );
    expect(first.media).toMatchObject({ downloaded: 0, skipped: 1, oversized: ["file-img-1"] });
    expect(fs.bytes.size).toBe(0);
    expect(JSON.parse(fs.files.get(MANIFEST)!)).toMatchObject({ media: first.media });

    const second = await runDownload(
      { options: options({ noMedia: false, maxMediaBytes: 1000 }) },
      {
        archive: createFakeArchive({ active: [chat("a", "Alpha", 100)], records: { a: record }, media }),
        fs,
        reporter: createReporter(),
        now: () => DAY_TWO,
      },
    );
    expect(second.media).toMatchObject({ downloaded: 1, skipped: 0, oversized: [] });
    expect(fs.bytes.size).toBe(1);
  });
});
