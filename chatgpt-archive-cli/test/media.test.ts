import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractMediaJobs, sanitizeMediaFilename } from "../../chatgpt-archive-core/src/index.ts";
import { parseArgs } from "../src/args.ts";
import { formatSummary, runDownload } from "../src/download.ts";
import { MEDIA_DIRECTORY, downloadMediaJobs } from "../src/media.ts";
import type { ArchiveFs } from "../src/storage.ts";
import { chat, createFakeArchive, createMemoryFs, createReporter, type FakeFs } from "./fakes.ts";

const NOW = Date.parse("2026-11-22T10:30:00Z");
const OUTPUT = join("/downloads", "chatgpt-2026-11-22");
const MEDIA = join(OUTPUT, MEDIA_DIRECTORY);
const MANIFEST = join(OUTPUT, "manifest.json");

const IMAGE_PATH = "/backend-api/files/file-img-1/download";
const VIDEO_PATH = "/backend-api/files/file-vid-2/download";
const LIBRARY_PATH = "/backend-api/files/libfile_3/download";
const IMAGE_FILE = sanitizeMediaFilename("file-img-1");
const VIDEO_FILE = sanitizeMediaFilename("file-vid-2");
const LIBRARY_FILE = sanitizeMediaFilename("libfile_3");

const imageRecord = {
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
const videoRecord = {
  mapping: {
    n2: {
      message: {
        content: { content_type: "video", asset_pointer: { file_id: "file-vid-2" } },
        metadata: { content_references: [{ library_file_id: "libfile_3" }] },
      },
    },
  },
};

function options(noMedia = false) {
  const parsed = parseArgs(noMedia ? ["download", "--no-media"] : ["download"]);
  if (parsed.kind !== "download") throw new Error("expected a download command");
  return { ...parsed.options, outRoot: "/downloads", noMedia };
}

const archive = () => createFakeArchive({
  active: [chat("a", "Alpha", 100), chat("b", "Bravo", 200)],
  records: { a: imageRecord, b: videoRecord },
  media: {
    [IMAGE_PATH]: new Uint8Array([1, 2, 3]),
    [VIDEO_PATH]: new Error("expired link"),
    [LIBRARY_PATH]: new Uint8Array([9]),
  },
});

describe("media download in the archive CLI", () => {
  it("writes referenced media, reports failures and counts everything in the manifest", async () => {
    const fs = createMemoryFs();
    const reporter = createReporter();
    const summary = await runDownload(
      { options: options() },
      { archive: archive(), fs, reporter, now: () => NOW },
    );

    expect(Array.from(fs.bytes.get(join(MEDIA, IMAGE_FILE)) ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(fs.bytes.get(join(MEDIA, LIBRARY_FILE)) ?? [])).toEqual([9]);
    expect(fs.bytes.has(join(MEDIA, VIDEO_FILE))).toBe(false);
    expect(fs.renames.map(([, to]) => to).sort()).toEqual([
      join(MEDIA, IMAGE_FILE), join(MEDIA, LIBRARY_FILE),
    ]);
    expect(summary.media).toEqual({
      downloaded: 2,
      failed: 1,
      skipped: 0,
      errors: [{ id: "file-vid-2", error: "expired link" }],
    });
    expect(JSON.parse(fs.files.get(MANIFEST)!)).toMatchObject({ media: summary.media });
    expect(formatSummary(summary)).toContain("file-vid-2 (expired link)");
    expect(reporter.reports.some((report) => report.phase === "media")).toBe(true);
  });

  it("keeps existing complete media files and never renames over them", async () => {
    const fs = createMemoryFs();
    fs.bytes.set(join(MEDIA, IMAGE_FILE), new Uint8Array([42]));
    const summary = await runDownload(
      { options: options() },
      { archive: archive(), fs, reporter: createReporter(), now: () => NOW },
    );

    expect(Array.from(fs.bytes.get(join(MEDIA, IMAGE_FILE)) ?? [])).toEqual([42]);
    expect(fs.renames.map(([, to]) => to)).not.toContain(join(MEDIA, IMAGE_FILE));
    expect(summary.media.skipped).toBe(1);
    expect(summary.media.downloaded).toBe(1);
    expect(summary.media.failed).toBe(1);
  });

  it("leaves no final file or part file when a write fails before the rename", async () => {
    const base = createMemoryFs();
    const fs: ArchiveFs & FakeFs = {
      ...base,
      writeBytes(path, bytes) {
        if (path.endsWith(".part")) throw new Error("disk full");
        base.writeBytes(path, bytes);
      },
    };
    const reporter = createReporter();
    const result = await downloadMediaJobs({
      fs,
      archive: createFakeArchive({ media: { [IMAGE_PATH]: new Uint8Array([1, 2, 3]) } }),
      reporter,
      outputDir: OUTPUT,
      jobs: extractMediaJobs(imageRecord),
    });

    expect(result).toEqual({
      downloaded: 0,
      failed: 1,
      skipped: 0,
      errors: [{ id: "file-img-1", error: "disk full" }],
    });
    expect(fs.bytes.size).toBe(0);
    expect(fs.renames).toEqual([]);
  });

  it("caps concurrent downloads at four", async () => {
    let inFlight = 0;
    let peak = 0;
    const many = {
      parts: Array.from({ length: 8 }, (_, index) => ({
        asset_pointer: "file-service://file-" + index,
      })),
    };
    const fs = createMemoryFs();
    const result = await downloadMediaJobs({
      fs,
      archive: createFakeArchive({
        mediaHandler: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await Promise.resolve();
          inFlight--;
          return new Uint8Array([7]);
        },
      }),
      reporter: createReporter(),
      outputDir: OUTPUT,
      jobs: extractMediaJobs(many),
    });

    expect(result.downloaded).toBe(8);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("skips all media work with --no-media", async () => {
    const fs = createMemoryFs();
    const reporter = createReporter();
    const summary = await runDownload(
      { options: options(true) },
      { archive: archive(), fs, reporter, now: () => NOW },
    );

    expect(parseArgs(["download", "--no-media"])).toMatchObject({
      options: { noMedia: true },
    });
    expect(summary.media).toEqual({ downloaded: 0, failed: 0, skipped: 0, errors: [] });
    expect(fs.bytes.size).toBe(0);
    expect(reporter.reports.find((report) => report.phase === "media")?.note).toBe("disabled");
    expect(JSON.parse(fs.files.get(MANIFEST)!)).toMatchObject({ media: summary.media });
  });
});
