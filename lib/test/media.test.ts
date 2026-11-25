import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_MEDIA_BYTES, formatMediaSize, isErrorContentType, mediaErrorBody, parseMediaSize } from "../media.ts";

describe("shared media helpers", () => {
  it("parses the same size units and zero for both archive CLIs", () => {
    expect(DEFAULT_MAX_MEDIA_BYTES).toBe(16 * 1024 * 1024);
    expect(parseMediaSize("16MB")).toBe(16 * 1024 * 1024);
    expect(parseMediaSize("500kb")).toBe(500 * 1024);
    expect(parseMediaSize("2g")).toBe(2 * 1024 * 1024 * 1024);
    expect(parseMediaSize("4096")).toBe(4096);
    expect(parseMediaSize("0")).toBe(0);
    expect(() => parseMediaSize("-1")).toThrow("--max-media-size");
    expect(() => parseMediaSize("16TB")).toThrow("--max-media-size");
  });

  it("formats the size used in CLI messages", () => {
    expect(formatMediaSize(0)).toBe("unlimited");
    expect(formatMediaSize(1024)).toBe("1 KB");
    expect(formatMediaSize(16 * 1024 * 1024)).toBe("16 MB");
    expect(formatMediaSize(1234)).toBe("1234 B");
  });

  it("recognizes error content types and JSON error bodies", () => {
    expect(isErrorContentType("text/plain; charset=utf-8")).toBe(true);
    expect(isErrorContentType("application/json")).toBe(true);
    expect(isErrorContentType("image/png")).toBe(false);
    const body = new TextEncoder().encode(JSON.stringify({ status: "error", error_code: "expired" }));
    expect(mediaErrorBody(body)).toContain("expired");
    expect(mediaErrorBody(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(mediaErrorBody(new TextEncoder().encode('{"ok":true}'))).toBeNull();
  });
});
