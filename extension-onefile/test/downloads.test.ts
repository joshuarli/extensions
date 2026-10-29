import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { downloadArchive } from "../src/downloads.ts";
import { DownloadFailedError } from "../src/errors.ts";

describe("downloadArchive", () => {
  it("passes a blob holding the exact bytes and filename to the transport", async () => {
    const transport = { downloadBlob: vi.fn(async (_blob: Blob, _filename: string) => 42) },
      bytes = new Uint8Array([80, 75, 3, 4]),
      id = await Effect.runPromise(downloadArchive(transport, { filename: "a.u.zip.html", bytes }));
    expect(id).toBe(42);
    const call = transport.downloadBlob.mock.calls.at(0);
    expect(call?.[1]).toBe("a.u.zip.html");
    expect(call?.[0]).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (call?.[0] as Blob).arrayBuffer())).toEqual(bytes);
  });

  it("downloads archives above the old data-url cap instead of refusing them", async () => {
    const transport = { downloadBlob: vi.fn(async () => 1) },
      id = await Effect.runPromise(downloadArchive(transport, {
        filename: "big.u.zip.html",
        bytes: new Uint8Array(2_000_000),
      }));
    expect(id).toBe(1);
    expect(transport.downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("maps transport refusal to rejected", async () => {
    const transport = {
      downloadBlob: vi.fn(async () => {
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
