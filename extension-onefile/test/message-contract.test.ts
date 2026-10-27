import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { CapturePayloadSchema, CaptureRequestSchema } from "../src/message-contract.ts";

describe("capture message contract", () => {
  it("accepts a minimal valid payload", () => {
    const payload = Schema.decodeUnknownSync(CapturePayloadSchema)({
      pageUrl: "https://example.com/",
      title: "Example",
      capturedAtMs: 1_700_000_000_000,
      pageHtml: "<!DOCTYPE html><p>hi</p>",
      resources: [{ url: "https://example.com/a.png", kind: "image" }],
      unresolved: [],
    });
    expect(payload.title).toBe("Example");
  });

  it("rejects payloads with unknown resource kinds or missing fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(CapturePayloadSchema)({
        pageUrl: "https://example.com/",
        title: "Example",
        capturedAtMs: 1,
        pageHtml: "<p>hi</p>",
        resources: [{ url: "https://example.com/a.png", kind: "video" }],
        unresolved: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CapturePayloadSchema)({ pageUrl: "https://example.com/" }),
    ).toThrow();
  });

  it("round-trips the capture request", () => {
    const request = Schema.decodeUnknownSync(CaptureRequestSchema)({ kind: "onefile-capture", saveId: "3-123" });
    expect(Schema.encodeSync(CaptureRequestSchema)(request)).toEqual({ kind: "onefile-capture", saveId: "3-123" });
  });
});
