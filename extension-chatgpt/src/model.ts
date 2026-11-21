import { TriageError } from "./errors.ts";

export type Action = "delete" | "archive" | "unarchive" | "rename" | "move" | "protect";
export type MutatingAction = Exclude<Action, "protect">;

export interface Chat {
  id: string;
  title: string;
  createdMs: number;
  updatedMs: number;
  projectId: string | null;
  gptId: string | null;
  pinned: boolean;
  archived: boolean;
}

export interface Project {
  id: string;
  name: string;
}

export interface Message {
  role: "user" | "assistant";
  text: string;
  timeMs: number;
}

export interface Conversation {
  title: string;
  messages: Message[];
  search: string;
}

export interface ConversationProbe {
  archived: boolean;
  visible: boolean;
  projectId: string | null;
  title: string | null;
}

export interface Mark {
  action: Action;
  title: string;
  newTitle: string | null;
  project: string;
  projectName: string;
  at: number;
}

export interface Protection {
  title: string;
  at: number;
}

export interface Settings {
  gap: number;
  backup: boolean;
  pinnedInSelectAll: boolean;
}

export interface Job {
  id: string;
  action: MutatingAction;
  newTitle: string | null;
  title: string;
  project: string;
  projectName: string;
  tries: number;
}

export type ResultStatus = "done" | "held" | "failed" | "unconfirmed";

export interface Result {
  id: string;
  action: MutatingAction;
  title: string;
  newTitle: string | null;
  project: string;
  projectName: string;
  status: ResultStatus;
  note: string;
  at: number;
}

export type RunStatus =
  | "backup"
  | "saving"
  | "running"
  | "waiting"
  | "verifying"
  | "paused"
  | "stopped"
  | "done";

export type RunPhase = "backup" | "save" | "write" | "verify";

export interface Run {
  id: string;
  status: RunStatus;
  phase: RunPhase;
  jobs: Job[];
  i: number;
  results: Result[];
  startedAt: number;
  owner: string;
  beat: number;
  lastWriteAt: number;
  nextAt: number;
  fails: number;
  note: string;
  current: string | null;
  held: Record<string, string>;
  backupCount: number;
  backupFile: string | null;
  backupDownloaded: string | null;
  finishedAt: number | null;
}

export interface Journal {
  accountId: string;
  marks: Record<string, Mark>;
  protect: Record<string, Protection>;
  seen: Record<string, number>;
  settings: Settings;
  run: Run | null;
  cooldownUntil: number;
  strikes: number;
}

export const ACTION_LABELS: Record<Action, string> = {
  delete: "Delete",
  archive: "Archive",
  unarchive: "Unarchive",
  rename: "Rename",
  move: "Move",
  protect: "Protect",
};

export const DEFAULT_SETTINGS: Settings = {
  gap: 8,
  backup: true,
  pinnedInSelectAll: false,
};

export function createJournal(accountId = "default"): Journal {
  return {
    accountId,
    marks: {},
    protect: {},
    seen: {},
    settings: { ...DEFAULT_SETTINGS },
    run: null,
    cooldownUntil: 0,
    strikes: 0,
  };
}

export function isUntitled(title: string): boolean {
  return !title || /^new chat$/iu.test(title);
}

export function toMs(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.max(0, parsed - nowMs);
}

// Reject a list that does not look like ChatGPT's, before any mutation is possible.
export function checkList(data: unknown): { items: unknown[]; total: number | null; compatible: boolean } {
  if (!data || typeof data !== "object") {
    throw new TriageError("compat", "ChatGPT's chat list looks different from what Triage expects, so Triage stopped.");
  }
  const record = data as { items?: unknown; total?: unknown };
  if (!Array.isArray(record.items) || !record.items.every((it) => it && typeof it === "object" && typeof (it as { id?: unknown }).id === "string")) {
    throw new TriageError("compat", "ChatGPT's chat list looks different from what Triage expects, so Triage stopped.");
  }
  const items = record.items;
  const wellFormed = items.filter((it) => {
    const row = it as { title?: unknown; create_time?: unknown };
    return "title" in row && "create_time" in row;
  }).length;
  return {
    items,
    total: typeof record.total === "number" && Number.isFinite(record.total) ? record.total : null,
    compatible: items.length === 0 || wellFormed > items.length / 2,
  };
}

export function normalizeListItem(item: unknown, archived: boolean): Chat | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row["id"] !== "string") return null;
  const template = String(row["conversation_template_id"] ?? "");
  const gizmo = String(row["gizmo_id"] ?? "");
  const projectId = template.startsWith("g-p-") ? template : gizmo.startsWith("g-p-") ? gizmo : null;
  const gptId = projectId ? null : gizmo.startsWith("g-") ? gizmo : template.startsWith("g-") ? template : null;
  return {
    id: row["id"],
    title: typeof row["title"] === "string" ? row["title"].trim() : "",
    createdMs: toMs(row["create_time"]),
    updatedMs: toMs(row["update_time"]),
    projectId,
    gptId,
    pinned: Boolean(row["pinned_time"] || row["is_starred"]),
    archived: archived || row["is_archived"] === true,
  };
}

export function parseProjects(data: unknown): Project[] {
  const found = new Map<string, Project>();
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  for (const item of items) {
    const inner = item && typeof item === "object"
      ? ((item as { gizmo?: unknown }).gizmo as { gizmo?: unknown } | undefined)?.gizmo
      : null;
    if (!inner || typeof inner !== "object") continue;
    const gizmo = inner as Record<string, unknown>;
    if (typeof gizmo["id"] !== "string" || !gizmo["id"].startsWith("g-p-")) continue;
    const display = gizmo["display"] as { name?: unknown } | undefined;
    const name = display && typeof display.name === "string" && display.name.trim();
    found.set(gizmo["id"], { id: gizmo["id"], name: name || "Untitled Project" });
  }
  return [...found.values()];
}

function textOf(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const row = content as { content_type?: unknown; parts?: unknown };
  if (row["content_type"] !== "text" && row["content_type"] !== "multimodal_text") return "";
  const parts = Array.isArray(row["parts"]) ? row["parts"] : [];
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const value = part as { text?: unknown; transcript?: unknown; content_type?: unknown };
        if (typeof value.text === "string") return value.text;
        if (typeof value.transcript === "string") return value.transcript;
        if (/image/iu.test(String(value.content_type ?? ""))) return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function parseConversation(data: unknown): Conversation {
  const source = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const map = source["mapping"] && typeof source["mapping"] === "object"
    ? (source["mapping"] as Record<string, unknown>)
    : {};
  const chain: Record<string, unknown>[] = [];
  const guard = new Set<string>();
  let node = typeof source["current_node"] === "string"
    ? (map[source["current_node"]] as Record<string, unknown> | undefined)
    : undefined;
  while (node && typeof node["id"] === "string" && !guard.has(node["id"])) {
    guard.add(node["id"]);
    chain.push(node);
    const parent = node["parent"];
    node = typeof parent === "string" ? (map[parent] as Record<string, unknown> | undefined) : undefined;
  }
  chain.reverse();
  if (chain.length === 0) {
    chain.push(...Object.values(map)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => entry as Record<string, unknown>)
      .sort((a, b) => {
        const messageA = a["message"] as { create_time?: unknown } | undefined;
        const messageB = b["message"] as { create_time?: unknown } | undefined;
        return toMs(messageA?.create_time) - toMs(messageB?.create_time);
      }));
  }
  const messages: Message[] = [];
  for (const entry of chain) {
    const message = entry["message"];
    if (!message || typeof message !== "object") continue;
    const row = message as {
      author?: { role?: unknown };
      metadata?: { is_visually_hidden_from_conversation?: unknown };
      content?: unknown;
      create_time?: unknown;
    };
    const role = row.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (row.metadata?.is_visually_hidden_from_conversation === true) continue;
    const text = textOf(row.content);
    if (!text.trim()) continue;
    messages.push({ role, text, timeMs: toMs(row.create_time) });
  }
  const title = typeof source["title"] === "string" ? source["title"] : "";
  return { title, messages, search: messages.map((m) => m.text).join("\n").toLowerCase().slice(0, 200_000) };
}

export function probeFromDetail(data: unknown): ConversationProbe {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const template = String(row["conversation_template_id"] ?? "");
  const gizmo = String(row["gizmo_id"] ?? "");
  const projectId = template.startsWith("g-p-") ? template : gizmo.startsWith("g-p-") ? gizmo : null;
  return {
    archived: row["is_archived"] === true,
    visible: row["is_visible"] !== false,
    projectId,
    title: typeof row["title"] === "string" ? row["title"] : null,
  };
}

export function whyNot(chat: Chat, action: Action, compatible: boolean, protectedIds: Record<string, Protection>): string | null {
  if (!compatible) return "Changes are switched off because ChatGPT's data looks unfamiliar.";
  if (protectedIds[chat.id]) return "That chat is protected. Unprotect it first.";
  if (action === "archive" && chat.archived) return "That chat is already archived.";
  if (action === "unarchive" && !chat.archived) return "Only archived chats can be unarchived.";
  if (action === "move" && chat.archived) return "Archived chats can't be moved. Unarchive it first.";
  if (action === "move" && chat.gptId) return "Chats with a custom GPT can't be moved into a project.";
  return null;
}

export function buildJobs(journal: Journal, chats: Chat[]): Job[] {
  const order = new Map<string, number>();
  [...chats].sort((a, b) => a.createdMs - b.createdMs).forEach((chat, index) => order.set(chat.id, index));
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  return Object.entries(journal.marks)
    .filter(([id, mark]) => !journal.protect[id] && mark.action !== "protect")
    .map(([id, mark]) => {
      const chat = byId.get(id);
      return {
        id,
        action: mark.action as MutatingAction,
        newTitle: mark.newTitle,
        title: chat ? chat.title : mark.title,
        project: mark.project,
        projectName: mark.projectName,
        tries: 0,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
}

export function requestBodyFor(job: Job): Record<string, string | boolean> {
  switch (job.action) {
    case "delete": return { is_visible: false };
    case "archive": return { is_archived: true };
    case "unarchive": return { is_archived: false };
    case "rename": return { title: job.newTitle ?? "" };
    case "move": return { gizmo_id: job.project };
  }
}

export function isMutatingAction(action: Action): action is MutatingAction {
  return action !== "protect";
}

export function toMarkdown(conversations: { id: string; title: string; createdMs: number; messages: Message[] }[]): string {
  const out = ["# ChatGPT backup", "", `Saved by ChatGPT Organizer. ${conversations.length} ${conversations.length === 1 ? "chat" : "chats"}.`, ""];
  for (const conv of conversations) {
    out.push("---", "", `## ${conv.title || "Untitled"}`, "");
    out.push(`Created ${conv.createdMs ? new Date(conv.createdMs).toLocaleString() : "unknown"} · https://chatgpt.com/c/${conv.id}`, "");
    for (const message of conv.messages) {
      out.push(`**${message.role === "user" ? "You" : "ChatGPT"}**`, "", message.text, "");
    }
  }
  return out.join("\n");
}

export function fileStamp(atMs: number): string {
  const date = new Date(atMs);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}-${two(date.getMinutes())}`;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
