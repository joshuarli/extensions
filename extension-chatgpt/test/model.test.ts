import { describe, expect, it } from "vitest";
import {
  buildBackup,
  buildJobs,
  checkList,
  commandOf,
  createJournal,
  describeConversation,
  fileStamp,
  isUntitled,
  normalizeListItem,
  parseConversation,
  parseProjects,
  parseRetryAfter,
  probeFromDetail,
  requestBodyFor,
  runControls,
  validatePlan,
  whyNot,
  type Chat,
  type PlanInput,
  type Run,
  type RunStatus,
} from "../src/model.ts";
import { TriageError } from "../src/errors.ts";
import { listItem, makeChat } from "./helpers.ts";

const branching = {
  title: "Monty Hall",
  is_archived: false,
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
    alt: {
      id: "alt", parent: "u1",
      message: { author: { role: "assistant" }, create_time: 2, content: { content_type: "code", text: "print(2/3)" } },
    },
    u2: {
      id: "u2", parent: "a1",
      message: {
        author: { role: "user" }, create_time: 3,
        content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer" }, "Why?"] },
        metadata: { attachments: [{ id: "file-1", name: "notes.pdf" }] },
      },
    },
    a2: {
      id: "a2", parent: "u2",
      message: { author: { role: "assistant" }, create_time: 4, content: { content_type: "text", parts: ["Two thirds"] } },
    },
  },
};

describe("chat list compatibility", () => {
  it("detects projects, custom GPTs and pinned chats", () => {
    const chat = normalizeListItem(listItem("a", {
      conversation_template_id: "g-p-thesis", gizmo_id: "g-p-thesis", pinned_time: "2024-01-01T00:00:00Z", is_archived: true,
    }), false);
    expect(chat).toMatchObject({ projectId: "g-p-thesis", gptId: null, pinned: true, archived: true });
    expect(normalizeListItem(listItem("b", { gizmo_id: "g-custom" }), false).gptId).toBe("g-custom");
  });

  it("rejects a page with any row missing the fields Triage reads", () => {
    expect(checkList({ items: [listItem("a")], total: 1 }).items).toHaveLength(1);
    const partial = { items: [listItem("a"), listItem("b"), { id: "c" }], total: 3 };
    expect(() => checkList(partial)).toThrow(TriageError);
    expect(() => checkList({ items: [{ ...listItem("a"), is_archived: "no" }] })).toThrow(TriageError);
    expect(() => checkList({ items: [{ ...listItem("a"), title: 7 }] })).toThrow(TriageError);
    expect(() => checkList({ conversations: [] })).toThrow(TriageError);
  });
});

describe("conversation records", () => {
  it("follows the visible branch and drops hidden messages", () => {
    const conversation = parseConversation(branching);
    expect(conversation.messages.map((message) => message.text)).toEqual(["Explain it", "[image]\nWhy?", "Two thirds"]);
  });

  it("describes branches, images, attachments and unrendered content", () => {
    expect(describeConversation(branching)).toEqual({
      messages: 5, branches: 2, images: 1, attachments: 1, unrendered: ["code"],
    });
    expect(() => describeConversation({ title: "no mapping" })).toThrow(TriageError);
  });

  it("probes state only from a recognizable record", () => {
    expect(probeFromDetail({ ...branching, is_archived: true }).archived).toBe(true);
    expect(probeFromDetail({ ...branching, is_visible: false }).visible).toBe(false);
    expect(probeFromDetail({ ...branching, conversation_template_id: "g-p-b" }).projectId).toBe("g-p-b");
    expect(() => probeFromDetail({ mapping: {}, title: "x" })).toThrow(TriageError);
    expect(() => probeFromDetail({ is_archived: false, title: "x" })).toThrow(TriageError);
    expect(() => probeFromDetail({ ...branching, is_visible: "false" })).toThrow(TriageError);
  });

  it("reads project ids from the sidebar response", () => {
    expect(parseProjects({
      items: [{ gizmo: { gizmo: { id: "g-p-work", display: { name: "Work" } } } }, { gizmo: { gizmo: { id: "g-custom" } } }],
    })).toEqual([{ id: "g-p-work", name: "Work" }]);
  });
});

describe("backup file", () => {
  it("keeps the full record and is byte-identical for the same input", async () => {
    const entries = [{ id: "a", title: "Monty Hall", createdMs: 1_700_000_000_000, record: branching, coverage: describeConversation(branching) }];
    const meta = { accountId: "u1", runId: "run-1", createdMs: 1_700_000_000_000 };
    const first = await buildBackup(meta, entries);
    const reordered = { ...entries[0], record: Object.fromEntries(Object.entries(branching).reverse()) };
    const second = await buildBackup(meta, [reordered as (typeof entries)[number]]);
    expect(second.text).toBe(first.text);
    expect(second.sha256).toBe(first.sha256);
    expect(first.ids).toEqual(["a"]);
    const parsed = JSON.parse(first.text) as { format: string; excludes: string; conversations: { record: { mapping: Record<string, unknown> }; coverage: { attachments: number }; transcript: unknown[] }[] };
    expect(parsed.format).toBe("chatgpt-organizer-backup");
    expect(parsed.excludes).toContain("not downloaded");
    expect(Object.keys(parsed.conversations[0]?.record.mapping ?? {})).toContain("alt");
    expect(parsed.conversations[0]?.coverage.attachments).toBe(1);
    expect(parsed.conversations[0]?.transcript).toHaveLength(3);
  });
});

describe("jobs and commands", () => {
  it("builds jobs only for loaded, valid, unprotected chats, oldest first", () => {
    const journal = createJournal("u1");
    journal.marks = {
      b: { action: "delete", title: "b", newTitle: null, project: "", projectName: "", at: 0 },
      a: { action: "rename", title: "a", newTitle: " New ", project: "", projectName: "", at: 0 },
      gone: { action: "delete", title: "Gone", newTitle: null, project: "", projectName: "", at: 0 },
      kept: { action: "delete", title: "Kept", newTitle: null, project: "", projectName: "", at: 0 },
      old: { action: "archive", title: "Old", newTitle: null, project: "", projectName: "", at: 0 },
    };
    journal.protect = { kept: { title: "Kept", at: 0 } };
    const chats: Chat[] = [
      makeChat("a", { createdMs: 10 }), makeChat("b", { createdMs: 20 }), makeChat("kept"), makeChat("old", { archived: true }),
    ];
    const { jobs, skipped } = buildJobs(journal, chats);
    expect(jobs.map((job) => `${job.action}:${job.id}`)).toEqual(["rename:a", "delete:b"]);
    expect(jobs[0]?.newTitle).toBe("New");
    expect(skipped.map((entry) => entry.id).sort()).toEqual(["gone", "kept", "old"]);
  });

  it("derives each PATCH body from its command", () => {
    expect(requestBodyFor({ action: "delete", id: "a" })).toEqual({ is_visible: false });
    expect(requestBodyFor({ action: "archive", id: "a" })).toEqual({ is_archived: true });
    expect(requestBodyFor({ action: "move", id: "a", project: "p1" })).toEqual({ gizmo_id: "p1" });
    expect(commandOf({ id: "a", action: "rename", newTitle: "T", title: "a", project: "x", projectName: "", tries: 0 })).toEqual({ action: "rename", id: "a", title: "T" });
    expect(() => commandOf({ id: "a", action: "rename", newTitle: "", title: "a", project: "", projectName: "", tries: 0 })).toThrow(TriageError);
  });

  it("guards actions on protected, archived and GPT chats", () => {
    const chat = makeChat("a", { archived: true, gptId: "g-custom" });
    expect(whyNot(chat, "archive", true, {})).toContain("already archived");
    expect(whyNot(chat, "move", true, {})).toContain("Archived chats");
    expect(whyNot(makeChat("b"), "move", true, { b: { title: "b", at: 0 } })).toContain("protected");
    expect(whyNot(makeChat("b"), "delete", false, {})).toContain("unfamiliar");
  });

  it("maps every run status to exactly one set of controls", () => {
    const expected: Record<RunStatus, string> = {
      backup: "working", running: "working", waiting: "working", verifying: "working",
      saving: "save-backup", paused: "paused", stopped: "finished", attention: "finished", done: "finished",
    };
    for (const [status, controls] of Object.entries(expected)) {
      expect(runControls({ status } as Run), status).toBe(controls);
    }
    expect(runControls(null)).toBe("idle");
  });
});

describe("imported plans", () => {
  const chats = [makeChat("a", { title: "Taxes" }), makeChat("b", { title: "Recipes" })];
  const context = { accountId: "u1", chats, projects: [{ id: "g-p-work", name: "Work" }], protect: {} };
  const entry = (action: PlanInput["marks"][string]["action"], title: string, extra = {}) => ({
    action, title, newTitle: null, project: "", projectName: "", at: 0, ...extra,
  });

  it("accepts a plan whose entries match this account's chats", () => {
    const check = validatePlan({
      version: 2, accountId: "u1", protect: {},
      marks: { a: entry("delete", "Taxes"), b: entry("move", "Recipes", { project: "g-p-work", projectName: "stale name" }) },
    }, context);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.marks["b"]?.projectName).toBe("Work");
  });

  it("rejects unknown chats, stale titles, other accounts and unknown projects", () => {
    const check = validatePlan({
      version: 2, accountId: "u2", protect: {},
      marks: {
        zzz: entry("delete", "Unknown"),
        a: entry("delete", "Old title"),
        b: entry("move", "Recipes", { project: "g-p-missing" }),
      },
    }, context);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.problems.join("\n")).toContain("different ChatGPT account");
      expect(check.problems.join("\n")).toContain("isn't in the loaded list");
      expect(check.problems.join("\n")).toContain("stale");
      expect(check.problems.join("\n")).toContain("doesn't exist");
    }
  });
});

describe("helpers", () => {
  it("parses Retry-After and stamps file names", () => {
    expect(parseRetryAfter("2", 0)).toBe(2000);
    expect(parseRetryAfter("Sun, 01 Jan 2028 00:00:00 GMT", 0)).toBeGreaterThan(0);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(isUntitled("New Chat")).toBe(true);
    expect(fileStamp(new Date(2024, 0, 2, 3, 4).getTime())).toBe("2024-01-02-03-04");
  });
});
