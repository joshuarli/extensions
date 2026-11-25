import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaJob } from "../../x-archive-core/src/media.ts";
import { downloadPostsMedia } from "../src/media.ts";

const session = { userId: "1", cookies: [] };
const job = (filename: string, path: string): MediaJob => ({
  tweet_id: "1", index: 0, kind: "photo", url: path, filename,
});

let server: Server;
let baseUrl: string;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "x-archive-media-test-"));
  server = createServer((request, response) => {
    if (request.url === "/small") {
      const body = Buffer.alloc(1024, 7);
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": String(body.length) });
      response.end(body);
    } else if (request.url === "/declared-large") {
      const body = Buffer.alloc(2048, 7);
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(body.length) });
      response.end(body);
    } else if (request.url === "/chunked-large") {
      response.writeHead(200, { "content-type": "video/mp4" });
      response.write(Buffer.alloc(1024, 7));
      response.write(Buffer.alloc(1024, 8));
      response.end();
    } else if (request.url === "/slow") {
      const body = Buffer.alloc(1024, 7);
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": String(body.length) });
      setTimeout(() => response.end(body), 300);
    } else if (request.url === "/error") {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("nope");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");
  baseUrl = "http://127.0.0.1:" + address.port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

function mediaFiles(): string[] {
  const mediaDir = join(root, "media");
  return existsSync(mediaDir) ? readdirSync(mediaDir) : [];
}

describe("media size limit", () => {
  it("writes files under the limit and records oversized ones as skipped", async () => {
    const result = await downloadPostsMedia([
      job("small.jpg", baseUrl + "/small"),
      job("large.mp4", baseUrl + "/declared-large"),
    ], { session, folder: root, maxBytes: 1024, signal: new AbortController().signal });

    expect(result.downloaded).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([{ filename: "large.mp4", bytes: 2048 }]);
    expect(readFileSync(join(root, "media", "small.jpg"))).toEqual(Buffer.alloc(1024, 7));
    expect(mediaFiles()).toEqual(["small.jpg"]);
  });

  it("discards a streamed download that passes the limit with no content-length", async () => {
    const result = await downloadPostsMedia([
      job("chunked.mp4", baseUrl + "/chunked-large"),
    ], { session, folder: root, maxBytes: 1024, signal: new AbortController().signal });

    expect(result.downloaded).toBe(0);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.filename).toBe("chunked.mp4");
    expect(mediaFiles()).toEqual([]);
  });

  it("downloads above the default limit when the limit is disabled", async () => {
    const result = await downloadPostsMedia([
      job("chunked.mp4", baseUrl + "/chunked-large"),
    ], { session, folder: root, maxBytes: 0, signal: new AbortController().signal });

    expect(result.downloaded).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(mediaFiles()).toEqual(["chunked.mp4"]);
  });

  it("keeps HTTP failures distinct from skipped media", async () => {
    const result = await downloadPostsMedia([
      job("error.jpg", baseUrl + "/error"),
    ], { session, folder: root, maxBytes: 1024, signal: new AbortController().signal });

    expect(result.downloaded).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.failed[0]!.error).toBe("HTTP 500");
    expect(mediaFiles()).toEqual([]);
  });

  it("starts nothing when already interrupted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await downloadPostsMedia([
      job("small.jpg", baseUrl + "/small"),
    ], { session, folder: root, maxBytes: 1024, signal: controller.signal });

    expect(result.stopped).toBe(true);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toEqual([]);
    expect(mediaFiles()).toEqual([]);
  });

  it("discards an in-flight download when interrupted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const result = await downloadPostsMedia([
      job("slow.jpg", baseUrl + "/slow"),
    ], { session, folder: root, maxBytes: 1024, signal: controller.signal });

    expect(result.stopped).toBe(true);
    expect(result.downloaded).toBe(0);
    expect(result.failed).toEqual([]);
    expect(mediaFiles()).toEqual([]);
  });
});
