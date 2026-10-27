import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { downloadArchive } from "../src/downloads.ts";
import { capturePolicy } from "../src/policy.ts";
import { DownloadFailedError } from "../src/errors.ts";

describe("downloadArchive", () => {
  it("passes a data url and filename to the transport", async () => {
    const transport = { downloadDataUrl: vi.fn(async (_url: string, _filename: string) => 42) },
      bytes = new Uint8Array([80, 75, 3, 4]),
      id = await Effect.runPromise(downloadArchive(transport, { filename: "a.u.zip.html", bytes }));
    expect(id).toBe(42);
    const call = transport.downloadDataUrl.mock.calls.at(0);
    expect(call?.[1]).toBe("a.u.zip.html");
    expect(String(call?.[0]).startsWith("data:application/octet-stream;base64,")).toBe(true);
  });

  it("refuses archives above the direct-download cap", async () => {
    const transport = { downloadDataUrl: vi.fn(async () => 1) },
      error = await Effect.runPromise(downloadArchive(transport, {
        filename: "big.u.zip.html",
        bytes: new Uint8Array(capturePolicy.maxDirectDownloadBytes + 1),
      }).pipe(Effect.flip));
    expect(error).toBeInstanceOf(DownloadFailedError);
    expect(error.kind).toBe("too-large");
    expect(transport.downloadDataUrl).not.toHaveBeenCalled();
  });

  it("maps transport refusal to rejected", async () => {
    const transport = {
      downloadDataUrl: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    const error = await Effect.runPromise(
      downloadArchive(transport, { filename: "a.u.zip.html", bytes: new Uint8Array([1]) }).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(DownloadFailedError);
    expect(error.kind).toBe("rejected");
  });
});
