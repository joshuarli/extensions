import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DownloadOptions } from "../src/args.ts";
import { runDownload } from "../src/download.ts";
import { sha256Hex, splitLines } from "../src/storage.ts";
import { chat, createFakeArchive, createMemoryFs, createReporter, lineFor } from "./fakes.ts";

const NOW = Date.parse("2026-11-22T10:30:00Z");
const OUTPUT = "/downloads/chatgpt-account-1";
const RECORDS = join(OUTPUT, "records.jsonl");
const MANIFEST = join(OUTPUT, "manifest.json");

function options(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    since: null,
    until: null,
    sinceMs: null,
    untilMs: null,
    timeField: "updated",
    outRoot: "/downloads",
    includeArchived: false,
    noMedia: false,
    maxMediaBytes: 16 * 1024 * 1024,
    limit: null,
    backend: undefined,
    session: undefined,
    cdpUrl: undefined,
    ...overrides,
  };
}

const chats = [
  chat("a", "Alpha", 100, 300),
  chat("b", "Bravo", 200, 200),
  chat("c", "Charlie", 300, 100),
];

describe("append-only archive and resume", () => {
  it("skips completed ids and appends only missing records", async () => {
    const first = lineFor("a", "Alpha", 100, 300);
    const second = lineFor("b", "Bravo", 200, 200);
    const fs = createMemoryFs({ [RECORDS]: `${first}\n${second}\n` });
    const reporter = createReporter();
    const summary = await runDownload(
      { options: options() },
      { archive: createFakeArchive({ active: chats }), fs, reporter, now: () => NOW },
    );

    expect(summary).toMatchObject({ written: 1, skipped: 2, total: 3, archived: 0, outputDir: OUTPUT });
    expect(splitLines(fs.files.get(RECORDS)!)).toEqual([first, second, expect.stringContaining('"id":"c"')]);
    expect(fs.files.get(RECORDS)!.startsWith(`${first}\n${second}\n`)).toBe(true);
    expect(fs.files.get(MANIFEST)).toContain('"total": 3');
    expect(fs.files.get(MANIFEST)).toContain('"sha256OfRecords": "' + await sha256Hex(fs.files.get(RECORDS)!) + '"');
    expect(reporter.reports.map((report) => report.phase)).toContain("manifest");
    expect(reporter.reports.at(-1)?.note).toBeUndefined();
  });

  it("continues a limited run on the next invocation", async () => {
    const fs = createMemoryFs();
    const first = await runDownload(
      { options: options({ limit: 1 }) },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => NOW },
    );
    expect(first.written).toBe(1);
    expect(splitLines(fs.files.get(RECORDS)!)).toHaveLength(1);

    const second = await runDownload(
      { options: options({ limit: 1 }) },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => NOW },
    );
    expect(second).toMatchObject({ written: 1, skipped: 1, total: 2 });
    expect(splitLines(fs.files.get(RECORDS)!).map((line) => JSON.parse(line).id)).toEqual(["a", "b"]);

    const third = await runDownload(
      { options: options({ limit: 1 }) },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => NOW },
    );
    expect(third).toMatchObject({ written: 1, skipped: 2, total: 3 });
    expect(splitLines(fs.files.get(RECORDS)!).map((line) => JSON.parse(line).id)).toEqual(["a", "b", "c"]);
  });

  it("preserves undecodable lines and does not count them as completed", async () => {
    const valid = lineFor("a", "Alpha", 100, 300);
    const fs = createMemoryFs({ [RECORDS]: `not-json\n${valid}\n` });
    const summary = await runDownload(
      { options: options() },
      { archive: createFakeArchive({ active: chats }), fs, reporter: createReporter(), now: () => NOW },
    );
    const lines = splitLines(fs.files.get(RECORDS)!);
    expect(lines[0]).toBe("not-json");
    expect(lines[1]).toBe(valid);
    expect(summary).toMatchObject({ written: 2, skipped: 1, total: 3 });
    expect(fs.files.get(MANIFEST)).toContain('"sha256OfRecords": "' + await sha256Hex(fs.files.get(RECORDS)!) + '"');
  });
});
