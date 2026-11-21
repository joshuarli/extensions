import { describe, expect, it } from "vitest";
import {
  buildJobs,
  checkList,
  createJournal,
  fileStamp,
  isUntitled,
  normalizeListItem,
  parseConversation,
  parseProjects,
  parseRetryAfter,
  probeFromDetail,
  requestBodyFor,
  toMarkdown,
  whyNot,
  type Chat,
} from "../src/model.ts";
import { TriageError } from "../src/errors.ts";
import { listItem, makeChat } from "./helpers.ts";

describe("conversation model", () => {
  it("detects projects, custom GPTs and pinned chats from list items", () => {
    const chat = normalizeListItem(listItem("a", {
      conversation_template_id: "g-p-thesis",
      gizmo_id: "g-p-thesis",
      pinned_time: "2024-01-01T00:00:00Z",
      is_archived: true,
    }), false);
    expect(chat?.projectId).toBe("g-p-thesis");
    expect(chat?.gptId).toBeNull();
    expect(chat?.pinned).toBe(true);
    expect(chat?.archived).toBe(true);
    expect(normalizeListItem(listItem("b", { gizmo_id: "g-custom" }), false)?.gptId).toBe("g-custom");
  });

  it("refuses unfamiliar lists before any mutation", () => {
    expect(() => checkList({ items: [{ title: "no id" }] })).toThrow(TriageError);
    expect(checkList({ items: [listItem("a")], total: 1 }).compatible).toBe(true);
    expect(checkList({ items: [{ id: "a" }] }).compatible).toBe(false);
  });

  it("follows the visible branch and drops hidden messages", () => {
    const conversation = parseConversation({
      title: "Monty Hall",
      current_node: "a2",
      mapping: {
        root: { id: "root", message: null, parent: null },
        u1: {
          id: "u1", parent: "root",
          message: { author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: ["Explain it"] } },
        },
        a1: {
          id: "a1", parent: "u1",
          message: { author: { role: "assistant" }, create_time: 2, content: { content_type: "text", parts: ["Switch"] }, metadata: { is_visually_hidden_from_conversation: true } },
        },
        u2: {
          id: "u2", parent: "a1",
          message: { author: { role: "user" }, create_time: 3, content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer" }, "Why?"] } },
        },
        a2: {
          id: "a2", parent: "u2",
          message: { author: { role: "assistant" }, create_time: 4, content: { content_type: "text", parts: ["Two thirds"] } },
        },
      },
    });
    expect(conversation.messages.map((message) => message.text)).toEqual(["Explain it", "[image]\nWhy?", "Two thirds"]);
    expect(conversation.search).toContain("two thirds");
  });

  it("reads project ids from the sidebar response", () => {
    const projects = parseProjects({
      items: [{
        gizmo: { gizmo: { id: "g-p-work", display: { name: "Work" } } },
      }, {
        gizmo: { gizmo: { id: "g-custom", display: { name: "GPT" } } },
      }],
      cursor: null,
    });
    expect(projects).toEqual([{ id: "g-p-work", name: "Work" }]);
  });

  it("probes archived, deleted and moved chats from the detail response", () => {
    expect(probeFromDetail({ is_archived: true, is_visible: true, gizmo_id: "g-p-a" }).archived).toBe(true);
    expect(probeFromDetail({ is_visible: false }).visible).toBe(false);
    expect(probeFromDetail({ conversation_template_id: "g-p-b" }).projectId).toBe("g-p-b");
    expect(probeFromDetail({ title: "Renamed" }).title).toBe("Renamed");
  });

  it("guards actions on protected, archived and GPT chats", () => {
    const chat = makeChat("a", { archived: true, gptId: "g-custom" });
    expect(whyNot(chat, "archive", true, {})).toContain("already archived");
    expect(whyNot(chat, "move", true, {})).toContain("Archived chats");
    expect(whyNot(makeChat("b"), "move", true, { b: { title: "b", at: 0 } })).toContain("protected");
    expect(whyNot(makeChat("b"), "delete", false, {})).toContain("unfamiliar");
    expect(whyNot(makeChat("b"), "delete", true, {})).toBeNull();
  });

  it("builds write bodies and orders jobs oldest first", () => {
    expect(requestBodyFor({ id: "a", action: "delete", newTitle: null, title: "a", project: "", projectName: "", tries: 0 })).toEqual({ is_visible: false });
    expect(requestBodyFor({ id: "a", action: "move", newTitle: null, title: "a", project: "p1", projectName: "", tries: 0 })).toEqual({ gizmo_id: "p1" });
    const journal = createJournal("u1");
    journal.marks = {
      b: { action: "delete", title: "b", newTitle: null, project: "", projectName: "", at: 0 },
      a: { action: "rename", title: "a", newTitle: "New", project: "", projectName: "", at: 0 },
    };
    const chats: Chat[] = [makeChat("a", { createdMs: 10 }), makeChat("b", { createdMs: 20 })];
    expect(buildJobs(journal, chats).map((job) => job.action)).toEqual(["rename", "delete"]);
  });

  it("writes a markdown backup and parses Retry-After", () => {
    const markdown = toMarkdown([{
      id: "a", title: "Chat a", createdMs: 0,
      messages: [{ role: "user", text: "hello", timeMs: 0 }, { role: "assistant", text: "hi", timeMs: 1 }],
    }]);
    expect(markdown).toContain("## Chat a");
    expect(markdown).toContain("**You**");
    expect(markdown).toContain("hi");
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("Sun, 01 Jan 2028 00:00:00 GMT", 0)).toBeGreaterThan(0);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(isUntitled("New Chat")).toBe(true);
    expect(fileStamp(new Date(2024, 0, 2, 3, 4).getTime())).toMatch(/^2024-01-02-03-04$/);
  });
});
