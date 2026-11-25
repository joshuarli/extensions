import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DownloadOptions } from "../src/args.ts";
import { runDownload } from "../src/download.ts";
import { splitLines } from "../src/storage.ts";
import { chat, createFakeArchive, createMemoryFs, createReporter } from "./fakes.ts";

const NOW = Date.parse("2026-11-22T10:30:00Z");
const RECORDS = join("/downloads", "chatgpt-account-1", "records.jsonl");
const MANIFEST = join("/downloads", "chatgpt-account-1", "manifest.json");

const active = [
  chat("a", "Alpha", 100, 300),
  chat("b", "Bravo", 200, 200),
  chat("c", "Charlie", 300, 100),
];
const archived = [
  chat("a", "Alpha archived", 100, 300, true),
  chat("d", "Delta", 250, 250, true),
  chat("e", "Echo", 50, 50, true),
];

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

async function idsWritten(optionsValue: DownloadOptions): Promise<{ ids: string[]; manifest: string; phases: string[] }> {
  const fs = createMemoryFs();
  const reporter = createReporter();
  await runDownload(
    { options: optionsValue },
    { archive: createFakeArchive({ active, archived }), fs, reporter, now: () => NOW },
  );
  return {
    ids: splitLines(fs.files.get(RECORDS) ?? "").map((line) => (JSON.parse(line) as { id: string }).id),
    manifest: fs.files.get(MANIFEST) ?? "",
    phases: reporter.reports.map((report) => report.phase),
  };
}

describe("timeframe and archived selection", () => {
  it("filters on update time by default, with inclusive bounds", async () => {
    const result = await idsWritten(options({
      since: "1970-01-01T00:00:00.200Z",
      until: "1970-01-01T00:00:00.300Z",
      sinceMs: 200,
      untilMs: 300,
    }));
    expect(result.ids).toEqual(["a", "b"]);
    expect(result.manifest).toContain('"since": "1970-01-01T00:00:00.200Z"');
    expect(result.manifest).toContain('"timeField": "updated"');
  });

  it("filters on creation time when time-field is created", async () => {
    const result = await idsWritten(options({
      since: "1970-01-01T00:00:00.200Z",
      until: "1970-01-01T00:00:00.300Z",
      sinceMs: 200,
      untilMs: 300,
      timeField: "created",
    }));
    expect(result.ids).toEqual(["b", "c"]);
    expect(result.manifest).toContain('"timeField": "created"');
  });

  it("adds archived chats, deduplicates ids and counts saved archived records", async () => {
    const result = await idsWritten(options({ includeArchived: true }));
    expect(result.ids).toEqual(["a", "b", "c", "d", "e"]);
    expect(result.phases).toContain("list archived");
    expect(result.manifest).toContain('"archived": 3');
  });

  it("leaves archived chats out unless --include-archived is set", async () => {
    const result = await idsWritten(options());
    expect(result.ids).toEqual(["a", "b", "c"]);
    expect(result.phases).toContain("list archived");
    expect(result.manifest).toContain('"archived": 0');
  });
});
