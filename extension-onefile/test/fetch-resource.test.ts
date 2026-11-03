import { describe, expect, it, vi } from "vitest";
import { fetchResourceBytes } from "../src/fetch-resource.ts";
import { ResourceFetchError } from "../src/errors.ts";

function stubResponse(body: Uint8Array, contentType: string | null, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => body.buffer as ArrayBuffer,
  } as unknown as Response;
}

describe("fetchResourceBytes", () => {
  it("returns bytes with the content-type mime", async () => {
    const data = new Uint8Array([1, 2, 3]),
      fetcher = vi.fn(async () => stubResponse(data, "image/png; charset=binary"));
    const result = await fetchResourceBytes("https://example.com/a.png", fetcher as typeof fetch);
    expect(result).toEqual({ data, mime: "image/png" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sniffs the mime from the url when the header is missing", async () => {
    const fetcher = vi.fn(async () => stubResponse(new Uint8Array([1]), null));
    const result = await fetchResourceBytes("https://example.com/a.woff2", fetcher as typeof fetch);
    expect(result.mime).toBe("font/woff2");
  });

  it("retries a failing status then reports bad-status", async () => {
    const fetcher = vi.fn(async () => stubResponse(new Uint8Array(0), "image/png", false, 404));
    await expect(fetchResourceBytes("https://example.com/a.png", fetcher as typeof fetch)).rejects.toThrowError(
      ResourceFetchError,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses oversized resources without retrying", async () => {
    const fetcher = vi.fn(async () => stubResponse(new Uint8Array(6_000_000), "image/png"));
    await expect(fetchResourceBytes("https://example.com/big.png", fetcher as typeof fetch)).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sniffs common extension mimes and lets the header win", async () => {
    for (const [file, mime] of [
      ["a.jpg", "image/jpeg"],
      ["a.svg", "image/svg+xml"],
      ["a.woff", "font/woff"],
      ["a.css", "text/css"],
      ["a.unknown", "application/octet-stream"],
    ] as const) {
      const fetcher = vi.fn(async () => stubResponse(new Uint8Array([1]), null));
      expect((await fetchResourceBytes(`https://example.com/${file}`, fetcher as typeof fetch)).mime).toBe(mime);
    }
    const headed = vi.fn(async () => stubResponse(new Uint8Array([1]), "text/html; charset=utf-8"));
    expect(
      (await fetchResourceBytes("https://example.com/a.png", headed as typeof fetch)).mime,
    ).toBe("text/html");
  });

  it("maps aborts to timeouts", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(fetchResourceBytes("https://example.com/slow.png", fetcher as typeof fetch)).rejects.toMatchObject(
      { reason: "timeout" },
    );
  });

});
