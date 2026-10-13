import { Schema } from "effect";
import { expect, test } from "vitest";
import {
  ExtensionMessageSchema,
  ExtensionResponseSchema,
} from "../src/message-contract.ts";
import { resolveMessageTab } from "../src/service-worker.ts";

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

test("external message target is bound to its sender tab", async () => {
  const senderTab = { id: 42, url: "https://www.youtube.com/watch?v=abc123" } as chrome.tabs.Tab,
    sender = { tab: senderTab } as chrome.runtime.MessageSender,
    getTab = async (tabId: number) => ({ id: tabId } as chrome.tabs.Tab);

  expect(await resolveMessageTab({ action: "getTranscript" }, sender, "external", getTab)).toBe(
    senderTab,
  );
  await expect(
    resolveMessageTab({ action: "getTranscript", tabId: 43 }, sender, "external", getTab),
  ).rejects.toThrow("External requests can only access the sending tab");
  await expect(
    resolveMessageTab(
      { action: "getTranscript" },
      {} as chrome.runtime.MessageSender,
      "external",
      getTab,
    ),
  ).rejects.toThrow("External requests must come from a browser tab");
});

test("internal popup message can still select its requested tab", async () => {
  const sender = {} as chrome.runtime.MessageSender,
    selectedTab = { id: 42 } as chrome.tabs.Tab;

  expect(
    await resolveMessageTab(
      { action: "copyTranscript", tabId: 42 },
      sender,
      "internal",
      async () => selectedTab,
    ),
  ).toBe(selectedTab);
});
