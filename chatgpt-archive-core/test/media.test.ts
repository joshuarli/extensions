import { describe, expect, it } from "vitest";
import { createChatgptArchive, extractMediaJobs, sanitizeMediaFilename } from "../src/index.ts";
import type { ChatgptTransport } from "../src/index.ts";
import { FakeTransport, makeDeps } from "./fakes.ts";

const record = {
  mapping: {
    n1: {
      message: {
        content: {
          content_type: "multimodal_text",
          parts: [
            { content_type: "image_asset_pointer", asset_pointer: "file-service://file-img-1" },
            { content_type: "image_asset_pointer", asset_pointer: "file-service://file-img-1" },
            "plain text",
          ],
        },
      },
    },
    n2: {
      message: {
        content: {
          content_type: "video",
          asset_pointer: { file_id: "file-vid-2", file_name: "clip 1.mp4" },
        },
        metadata: {
          content_references: [{ type: "file", library_file_id: "libfile_3" }],
        },
      },
    },
  },
};

describe("media pointers", () => {
  it("extracts string pointers, object pointers and library references once each", () => {
    const jobs = extractMediaJobs(record);
    expect(jobs.map((job) => job.id)).toEqual(["file-img-1", "file-vid-2", "libfile_3"]);
    expect(jobs[0]).toEqual({
      id: "file-img-1",
      filename: sanitizeMediaFilename("file-img-1"),
      path: "/backend-api/files/file-img-1/download",
    });
    expect(jobs[1]?.filename).toMatch(/^clip_1\.mp4-[0-9a-f]{8}\.bin$/);
    expect(jobs[2]?.path).toBe("/backend-api/files/libfile_3/download");
    expect(extractMediaJobs({})).toEqual([]);
  });

  it("sanitizes filenames deterministically and keeps them inside one directory", () => {
    const first = sanitizeMediaFilename("file-../../secret?token=1");
    expect(first).toBe(sanitizeMediaFilename("file-../../secret?token=1"));
    expect(first).not.toContain("/");
    expect(first).not.toContain("..");
    expect(first).toMatch(/^[A-Za-z0-9._-]+-[0-9a-f]{8}\.bin$/);
    expect(sanitizeMediaFilename("a/b", "report final.txt")).toMatch(/^report_final\.txt-[0-9a-f]{8}\.bin$/);
  });

  it("downloads bytes through the injected transport with the session token and request gap", async () => {
    const transport = new FakeTransport().addBytes("/backend-api/files/file-img-1/download", new Uint8Array([1, 2, 3]));
    const { deps, sleepCalls } = makeDeps(transport, 25);
    const api = createChatgptArchive(deps);
    api.setToken("secret-token");

    const bytes = await api.getMediaBytes("/backend-api/files/file-img-1/download");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(transport.byteCalls).toEqual([{
      path: "/backend-api/files/file-img-1/download",
      headers: { Authorization: "Bearer secret-token" },
    }]);
    expect(sleepCalls).toEqual([25]);
  });

  it("fails clearly when the transport cannot download bytes", async () => {
    const transport: ChatgptTransport = { getJson: async () => ({}) };
    const api = createChatgptArchive(makeDeps(transport).deps);
    api.setToken("secret-token");
    await expect(api.getMediaBytes("/backend-api/files/x/download")).rejects.toThrow("cannot download media bytes");
  });
});
