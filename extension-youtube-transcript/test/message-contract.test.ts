import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  ExtensionMessageSchema,
  ExtensionResponseSchema,
} from "../src/message-contract.ts";

test("decodes extension messages before dispatch", () => {
  expect(
    Schema.decodeUnknownSync(ExtensionMessageSchema)({
      action: "copyTranscript",
      tabId: 42,
    }),
  ).toEqual({ action: "copyTranscript", tabId: 42 });
  expect(() =>
    Schema.decodeUnknownSync(ExtensionMessageSchema)({ action: "copyTranscript", tabId: "42" }),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(ExtensionMessageSchema)({ action: "runUnknownAction" }),
  ).toThrow();
});

test("decodes each serialized extension response variant", () => {
  expect(
    Schema.decodeUnknownSync(ExtensionResponseSchema)({ label: "Transcript copied!" }),
  ).toEqual({ label: "Transcript copied!" });
  expect(
    Schema.decodeUnknownSync(ExtensionResponseSchema)({ transcript: "Transcript text" }),
  ).toEqual({ transcript: "Transcript text" });
  expect(
    Schema.decodeUnknownSync(ExtensionResponseSchema)({
      error: "Could not access this tab.",
      errorDetail: "TabNotAccessibleError",
    }),
  ).toEqual({ error: "Could not access this tab.", errorDetail: "TabNotAccessibleError" });
});
