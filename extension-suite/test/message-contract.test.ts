import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  isSuiteRequest,
  SuiteRequestSchema,
  SuiteResponseSchema,
} from "../src/message-contract.ts";

test("accepts namespaced suite requests", () => {
  expect(
    Schema.decodeUnknownSync(SuiteRequestSchema)({
      kind: "allow-right-click/toggle",
      tabId: 7,
    }),
  ).toEqual({ kind: "allow-right-click/toggle", tabId: 7 });
  expect(
    Schema.decodeUnknownSync(SuiteRequestSchema)({
      kind: "onefile/save",
      tabId: 7,
    }),
  ).toEqual({ kind: "onefile/save", tabId: 7 });
  expect(
    Schema.decodeUnknownSync(SuiteRequestSchema)({ kind: "chatgpt/open-dashboard" }),
  ).toEqual({ kind: "chatgpt/open-dashboard" });
  expect(isSuiteRequest({ kind: "allow-right-click/status", tabId: 7 })).toBe(true);
  expect(isSuiteRequest({ kind: "chatgpt/open-dashboard" })).toBe(true);
});

test("rejects unknown or malformed suite requests", () => {
  expect(isSuiteRequest({ kind: "youtube-transcript/copy", tabId: 7 })).toBe(false);
  expect(isSuiteRequest({ kind: "x-bookmarks/run", job: "profile", action: "download" })).toBe(false);
  expect(isSuiteRequest({ kind: "onefile/save", tabId: "7" })).toBe(false);
  expect(isSuiteRequest({ kind: "chatgpt/open-dashboard", tabId: 7 })).toBe(false);
  expect(() =>
    Schema.decodeUnknownSync(SuiteRequestSchema)({ kind: "allow-right-click/toggle" }),
  ).toThrow();
});

test("decodes status and completion responses", () => {
  expect(Schema.decodeUnknownSync(SuiteResponseSchema)({ ok: true })).toEqual({ ok: true });
  expect(
    Schema.decodeUnknownSync(SuiteResponseSchema)({ ok: false, error: "No active tab." }),
  ).toEqual({ ok: false, error: "No active tab." });
  expect(Schema.decodeUnknownSync(SuiteResponseSchema)({ status: "on" })).toEqual({
    status: "on",
  });
  expect(() => Schema.decodeUnknownSync(SuiteResponseSchema)({ status: "maybe" })).toThrow();
});
