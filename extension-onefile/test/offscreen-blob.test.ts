import { describe, expect, it } from "vitest";
import { handleBlobUrlMessage } from "../src/offscreen.ts";
import { blobMessageKind, releaseBlobMessage, type BlobPort } from "../src/offscreen-protocol.ts";

function fakePort(): BlobPort & { posted: unknown[]; closed: boolean } {
  const posted: unknown[] = [];
  return {
    posted,
    closed: false,
    onmessage: null,
    postMessage(message: unknown) { posted.push(message); },
    close() { this.closed = true; },
  };
}

describe("onefile offscreen blob lifecycle", () => {
  it("revokes the URL and closes the port only after release", () => {
    const port = fakePort(),
      revoked: string[] = [];
    handleBlobUrlMessage(
      { kind: blobMessageKind, bytes: new ArrayBuffer(8), type: "application/octet-stream" },
      port,
      () => "blob:archive",
      (url) => { revoked.push(url); },
    );
    expect(port.posted).toEqual(["blob:archive"]);
    expect(revoked).toEqual([]);
    expect(port.closed).toBe(false);

    port.onmessage!({ data: releaseBlobMessage } as MessageEvent<unknown>);
    expect(revoked).toEqual(["blob:archive"]);
    expect(port.closed).toBe(true);
  });

  it("ignores unrelated messages", () => {
    const port = fakePort();
    handleBlobUrlMessage({ kind: "other" }, port, () => "blob:archive", () => {});
    expect(port.posted).toEqual([]);
    expect(port.onmessage).toBeNull();
  });
});
