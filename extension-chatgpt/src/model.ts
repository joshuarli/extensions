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
  projectId?: string | null;
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

// The exact write a run may perform. Its PATCH body is derived only from this value,
// inside the content script, so an authorization can never carry a different body.
export type Command =
  | { readonly action: "delete" | "archive" | "unarchive"; readonly id: string }
  | { readonly action: "rename"; readonly id: string; readonly title: string }
  | { readonly action: "move"; readonly id: string; readonly project: string };

export interface Job {
  id: string;
  action: MutatingAction;
  newTitle: string | null;
  title: string;
  project: string;
  projectName: string;
  tries: number;
  markAt?: number;
}

export type ResultStatus = "pending" | "verified" | "unverified" | "held" | "failed" | "mismatch";

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
  | "attention"
  | "done";

export type RunPhase = "backup" | "save" | "write" | "verify";

// A write that may have reached ChatGPT. It is durable before the write is sent and
// is cleared only once the outcome is known.
export interface Inflight {
  id: string;
  sentAt: number;
  outcome: "sent" | "unknown";
}

export interface SavedBackup {
  file: string;
  sha256: string;
  ids: string[];
  recordDigests?: Record<string, string>;
  verification: "file" | "confirmed";
  at: number;
}

export interface BackupState {
  required: boolean;
  acceptIncomplete: boolean;
  saved: SavedBackup | null;
}

export interface Run {
  id: string;
  accountId: string;
  status: RunStatus;
  phase: RunPhase;
  jobs: Job[];
  i: number;
  results: Result[];
  startedAt: number;
  lastWriteAt: number;
  nextAt: number;
  fails: number;
  note: string;
  inflight: Inflight | null;
  held: Record<string, string>;
  backup: BackupState;
  finishedAt: number | null;
}

export interface Journal {
  accountId: string;
  marks: Record<string, Mark>;
  protect: Record<string, Protection>;
  settings: Settings;
  run: Run | null;
  cooldownUntil: number;
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

export function createJournal(accountId: string): Journal {
  return {
    accountId,
    marks: {},
    protect: {},
    settings: { ...DEFAULT_SETTINGS },
    run: null,
    cooldownUntil: 0,
  };
}

export type RunControls = "idle" | "working" | "save-backup" | "paused" | "finished";

export function runControls(run: Run | null): RunControls {
  if (!run) return "idle";
  switch (run.status) {
    case "saving": return "save-backup";
    case "backup":
    case "running":
    case "waiting":
    case "verifying": return "working";
    case "paused": return "paused";
    case "stopped":
    case "attention":
    case "done": return "finished";
  }
}

export function isRunActive(run: Run | null): boolean {
  const controls = runControls(run);
  return controls === "working" || controls === "save-backup";
}

export const INTERRUPTED_NOTE = "Interrupted when the dashboard closed. Review it and resume deliberately.";

// A dashboard that holds the runner lock and finds an active run knows its runner is gone.
export function recoverInterrupted(journal: Journal): void {
  const run = journal.run;
  if (!run || !isRunActive(run)) return;
  run.status = "paused";
  run.note = INTERRUPTED_NOTE;
  run.nextAt = 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTime(value: unknown): boolean {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

const LIST_COMPAT = "ChatGPT's chat list looks different from what Triage expects, so Triage stopped.";

// Every row must carry the fields Triage reads. One unfamiliar row rejects the page,
// before any mutation is possible.
export function checkList(data: unknown): { items: Record<string, unknown>[]; total: number | null } {
  if (!isRecord(data) || !Array.isArray(data["items"])) throw new TriageError("compat", LIST_COMPAT);
  const items: Record<string, unknown>[] = [];
  for (const item of data["items"] as unknown[]) {
    if (
      !isRecord(item)
      || typeof item["id"] !== "string"
      || !item["id"]
      || !isStringOrNull(item["title"])
      || !isTime(item["create_time"])
      || !isTime(item["update_time"])
      || ("is_archived" in item && item["is_archived"] != null && typeof item["is_archived"] !== "boolean")
      || ("gizmo_id" in item && !isStringOrNull(item["gizmo_id"]))
      || ("conversation_template_id" in item && !isStringOrNull(item["conversation_template_id"]))
    ) {
      throw new TriageError("compat", LIST_COMPAT);
    }
    items.push(item);
  }
  const total = data["total"];
  return { items, total: typeof total === "number" && Number.isFinite(total) ? total : null };
}

function projectOf(row: Record<string, unknown>): { projectId: string | null; gptId: string | null } {
  const template = typeof row["conversation_template_id"] === "string" ? row["conversation_template_id"] : "";
  const gizmo = typeof row["gizmo_id"] === "string" ? row["gizmo_id"] : "";
  const projectId = template.startsWith("g-p-") ? template : gizmo.startsWith("g-p-") ? gizmo : null;
  const gptId = projectId ? null : gizmo.startsWith("g-") ? gizmo : template.startsWith("g-") ? template : null;
  return { projectId, gptId };
}

export function normalizeListItem(row: Record<string, unknown>, archived: boolean): Chat {
  return {
    id: String(row["id"]),
    title: typeof row["title"] === "string" ? row["title"].trim() : "",
    createdMs: toMs(row["create_time"]),
    updatedMs: toMs(row["update_time"]),
    ...projectOf(row),
    pinned: Boolean(row["pinned_time"] || row["is_starred"]),
    archived: archived || row["is_archived"] === true,
  };
}

export function parseProjects(data: unknown): Project[] {
  const found = new Map<string, Project>();
  if (!isRecord(data)) return [];
  const items = data["items"];
  if (!Array.isArray(items)) return [];
  for (const item of items as unknown[]) {
    const outer = isRecord(item) ? item["gizmo"] : null;
    const gizmo = isRecord(outer) ? outer["gizmo"] : null;
    if (!isRecord(gizmo)) continue;
    const id = gizmo["id"];
    if (typeof id !== "string" || !id.startsWith("g-p-")) continue;
    const display = gizmo["display"];
    const name = isRecord(display) && typeof display["name"] === "string" ? display["name"].trim() : "";
    found.set(id, { id, name: name || "Untitled Project" });
  }
  return [...found.values()];
}

function partsOf(content: unknown): unknown[] {
  return isRecord(content) && Array.isArray(content["parts"]) ? content["parts"] as unknown[] : [];
}

function isImagePart(part: unknown): boolean {
  return isRecord(part) && /image/iu.test(String(part["content_type"] ?? ""));
}

function textOf(content: unknown): string {
  if (!isRecord(content)) return "";
  if (content["content_type"] !== "text" && content["content_type"] !== "multimodal_text") return "";
  return partsOf(content)
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part)) {
        if (typeof part["text"] === "string") return part["text"];
        if (typeof part["transcript"] === "string") return part["transcript"];
        if (isImagePart(part)) return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function mappingOf(source: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const mapping = source["mapping"];
  const out: Record<string, Record<string, unknown>> = {};
  if (!isRecord(mapping)) return out;
  for (const [key, node] of Object.entries(mapping)) {
    if (isRecord(node)) out[key] = node;
  }
  return out;
}

export function parseConversation(data: unknown): Conversation {
  const source = isRecord(data) ? data : {};
  const map = mappingOf(source);
  const chain: Record<string, unknown>[] = [];
  const guard = new Set<string>();
  const current = source["current_node"];
  let node = typeof current === "string" ? map[current] : undefined;
  while (node && typeof node["id"] === "string" && !guard.has(node["id"])) {
    guard.add(node["id"]);
    chain.push(node);
    const parent = node["parent"];
    node = typeof parent === "string" ? map[parent] : undefined;
  }
  chain.reverse();
  if (chain.length === 0) {
    chain.push(...Object.values(map).sort((a, b) => {
      const messageA = isRecord(a["message"]) ? a["message"]["create_time"] : null;
      const messageB = isRecord(b["message"]) ? b["message"]["create_time"] : null;
      return toMs(messageA) - toMs(messageB);
    }));
  }
  const messages: Message[] = [];
  for (const entry of chain) {
    const message = entry["message"];
    if (!isRecord(message)) continue;
    const author = message["author"];
    const role = isRecord(author) ? author["role"] : null;
    if (role !== "user" && role !== "assistant") continue;
    const metadata = message["metadata"];
    if (isRecord(metadata) && metadata["is_visually_hidden_from_conversation"] === true) continue;
    const text = textOf(message["content"]);
    if (!text.trim()) continue;
    messages.push({ role, text, timeMs: toMs(message["create_time"]) });
  }
  const title = typeof source["title"] === "string" ? source["title"] : "";
  return { title, messages, search: messages.map((m) => m.text).join("\n").toLowerCase().slice(0, 200_000) };
}

const DETAIL_COMPAT = "ChatGPT's conversation record looks different from what Triage expects, so it can't confirm the change.";

// A probe decides whether a write took effect, so a missing field is never read as false.
export function probeFromDetail(data: unknown): ConversationProbe {
  if (
    !isRecord(data)
    || !isRecord(data["mapping"])
    || typeof data["is_archived"] !== "boolean"
    || !isStringOrNull(data["title"])
    || ("is_visible" in data && typeof data["is_visible"] !== "boolean")
    || ("gizmo_id" in data && !isStringOrNull(data["gizmo_id"]))
    || ("conversation_template_id" in data && !isStringOrNull(data["conversation_template_id"]))
  ) {
    throw new TriageError("compat", DETAIL_COMPAT);
  }
  return {
    archived: data["is_archived"],
    visible: data["is_visible"] !== false,
    ...("gizmo_id" in data || "conversation_template_id" in data ? { projectId: projectOf(data).projectId } : {}),
    title: data["title"],
  };
}

export interface Coverage {
  messages: number;
  branches: number;
  images: number;
  attachments: number;
  unrendered: string[];
}

function hasMediaReference(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("file-service://");
  if (Array.isArray(value)) return value.some(hasMediaReference);
  return isRecord(value) && Object.entries(value).some(([key, entry]) =>
    (key === "asset_pointer" && entry != null) || hasMediaReference(entry));
}

// Describes what a backup of this record contains and what it cannot contain.
export function describeConversation(data: unknown): Coverage {
  if (!isRecord(data) || !isRecord(data["mapping"])) {
    throw new TriageError("compat", "ChatGPT returned a conversation record Triage doesn't recognize.");
  }
  const map = data["mapping"];
  const parents = new Set<string>();
  let messages = 0;
  let images = 0;
  let attachments = 0;
  const unrendered = new Set<string>();
  for (const node of Object.values(map)) {
    if (!isRecord(node)) {
      unrendered.add("unknown conversation node");
      continue;
    }
    if (typeof node["parent"] === "string") parents.add(node["parent"]);
    const message = node["message"];
    if (message === null) continue;
    if (!isRecord(message)) {
      unrendered.add("unknown message");
      continue;
    }
    messages += 1;
    const content = message["content"];
    const type = isRecord(content) ? content["content_type"] : null;
    const author = message["author"];
    const role = isRecord(author) ? author["role"] : null;
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "developer") {
      unrendered.add("tool output or unknown author");
    }
    const recipient = message["recipient"];
    if (typeof recipient === "string" && recipient !== "all") unrendered.add("tool call");
    if (type !== "text" && type !== "multimodal_text") {
      unrendered.add(typeof type === "string" && type ? type : "unknown content");
    } else if (!isRecord(content) || !Array.isArray(content["parts"])
      || Object.keys(content).some((key) => key !== "content_type" && key !== "parts")) {
      unrendered.add("unknown content");
    }
    for (const part of partsOf(content)) {
      if (isImagePart(part)) images += 1;
      else if (typeof part !== "string") {
        const partType = isRecord(part) ? part["content_type"] : null;
        unrendered.add(typeof partType === "string" && partType ? partType : "unknown content part");
      }
    }
    const metadata = message["metadata"];
    if (isRecord(metadata)) {
      const files = metadata["attachments"];
      if (Array.isArray(files)) attachments += files.length;
      else if (files != null) unrendered.add("unknown attachments");
      if (hasMediaReference(metadata)) unrendered.add("media reference in message metadata");
    } else if (metadata != null) {
      unrendered.add("unknown message metadata");
    }
  }
  if (!messages) unrendered.add("no readable messages");
  const leaves = Object.keys(map).filter((id) => !parents.has(id)).length;
  return { messages, branches: Math.max(1, leaves), images, attachments, unrendered: [...unrendered].sort() };
}

export function isIncomplete(coverage: Coverage): boolean {
  return coverage.images + coverage.attachments + coverage.unrendered.length > 0;
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

export interface SkippedMark {
  id: string;
  title: string;
  reason: string;
}

// Only marks that name a loaded, unprotected chat and remain valid for it become jobs.
export function buildJobs(journal: Journal, chats: Chat[]): { jobs: Job[]; skipped: SkippedMark[] } {
  const order = new Map<string, number>();
  [...chats].sort((a, b) => a.createdMs - b.createdMs).forEach((chat, index) => order.set(chat.id, index));
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const jobs: Job[] = [];
  const skipped: SkippedMark[] = [];
  for (const [id, mark] of Object.entries(journal.marks)) {
    if (mark.action === "protect") continue;
    const chat = byId.get(id);
    if (!chat) {
      skipped.push({ id, title: mark.title, reason: "It isn't in the loaded chat list." });
      continue;
    }
    const reason = whyNot(chat, mark.action, true, journal.protect)
      ?? (mark.action === "rename" && !mark.newTitle?.trim() ? "The new title is empty." : null);
    if (reason) {
      skipped.push({ id, title: chat.title, reason });
      continue;
    }
    jobs.push({
      id,
      action: mark.action,
      newTitle: mark.action === "rename" ? (mark.newTitle ?? "").trim() : null,
      title: chat.title,
      project: mark.action === "move" ? mark.project : "",
      projectName: mark.action === "move" ? mark.projectName : "",
      tries: 0,
      markAt: mark.at,
    });
  }
  jobs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { jobs, skipped };
}

export function commandOf(job: Job): Command {
  switch (job.action) {
    case "delete":
    case "archive":
    case "unarchive":
      return { action: job.action, id: job.id };
    case "rename":
      if (!job.newTitle?.trim()) throw new TriageError("http", `The new title for ${job.id} is empty.`);
      return { action: "rename", id: job.id, title: job.newTitle };
    case "move":
      return { action: "move", id: job.id, project: job.project };
  }
}

export function requestBodyFor(command: Command): Record<string, string | boolean> {
  switch (command.action) {
    case "delete": return { is_visible: false };
    case "archive": return { is_archived: true };
    case "unarchive": return { is_archived: false };
    case "rename": return { title: command.title };
    case "move": return { gizmo_id: command.project };
  }
}

export function sameCommand(a: Command, b: Command): boolean {
  if (a.id !== b.id || a.action !== b.action) return false;
  if (a.action === "rename" && b.action === "rename") return a.title === b.title;
  if (a.action === "move" && b.action === "move") return a.project === b.project;
  return true;
}

export function satisfies(job: Job, probe: ConversationProbe): boolean {
  switch (job.action) {
    case "delete": return !probe.visible;
    case "archive": return probe.archived;
    case "unarchive": return !probe.archived;
    case "rename": return probe.title === job.newTitle;
    case "move": return (probe.projectId ?? "") === job.project;
  }
}

export function applyToInventory(chats: Chat[], job: Job, nowMs: number): void {
  const index = chats.findIndex((chat) => chat.id === job.id);
  const chat = chats[index];
  if (!chat) return;
  switch (job.action) {
    case "delete": chats.splice(index, 1); break;
    case "archive": chat.archived = true; break;
    case "unarchive": chat.archived = false; break;
    case "rename": chat.title = job.newTitle ?? chat.title; break;
    case "move":
      chat.projectId = job.project || null;
      chat.updatedMs = nowMs;
      break;
  }
}

export function jobOf(result: Result): Job {
  return {
    id: result.id,
    action: result.action,
    newTitle: result.newTitle,
    title: result.title,
    project: result.project,
    projectName: result.projectName,
    tries: 0,
  };
}

export function isMutatingAction(action: Action): action is MutatingAction {
  return action !== "protect";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function backupRecordDigest(record: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(sortKeys(record)));
}

export interface BackupEntry {
  id: string;
  title: string;
  createdMs: number;
  record: unknown;
  coverage: Coverage;
}

export interface BuiltBackup {
  text: string;
  sha256: string;
  ids: string[];
  recordDigests: Record<string, string>;
}

export const BACKUP_FORMAT = "chatgpt-organizer-backup";

export const BACKUP_INCLUDES = "The complete conversation record ChatGPT returned for each chat: every message on every branch, message metadata, and the ids of attachments and images.";

export const BACKUP_EXCLUDES = "Attachments and media are not downloaded. Tool output and unfamiliar content can also reference data the backup cannot recover.";

// The same run and records always produce the same bytes, so the file hash identifies its content.
export async function buildBackup(
  meta: { accountId: string; runId: string; createdMs: number },
  entries: readonly BackupEntry[],
): Promise<BuiltBackup> {
  const conversations = [];
  for (const entry of entries) {
    const record = sortKeys(entry.record);
    conversations.push({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdMs ? new Date(entry.createdMs).toISOString() : null,
      url: `https://chatgpt.com/c/${entry.id}`,
      recordSha256: await sha256Hex(JSON.stringify(record)),
      coverage: entry.coverage,
      transcript: parseConversation(entry.record).messages.map((message) => ({ role: message.role, text: message.text })),
      record,
    });
  }
  const text = `${JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    accountId: meta.accountId,
    runId: meta.runId,
    createdAt: new Date(meta.createdMs).toISOString(),
    includes: BACKUP_INCLUDES,
    excludes: BACKUP_EXCLUDES,
    conversations,
  }, null, 2)}\n`;
  return {
    text,
    sha256: await sha256Hex(text),
    ids: conversations.map((entry) => entry.id),
    recordDigests: Object.fromEntries(conversations.map((entry) => [entry.id, entry.recordSha256])),
  };
}

export interface PlanInput {
  version: number;
  accountId: string;
  marks: Record<string, Omit<Mark, "action"> & { action: MutatingAction }>;
  protect: Record<string, Protection>;
}

export type PlanCheck =
  | { ok: true; marks: Record<string, Mark>; protect: Record<string, Protection> }
  | { ok: false; problems: string[] };

// An imported plan is accepted only if every entry names a loaded chat of this account,
// still has the title the plan was made with, and is a valid change for that chat.
export function validatePlan(
  plan: PlanInput,
  context: { accountId: string; chats: Chat[]; projects: Project[]; protect: Record<string, Protection> },
): PlanCheck {
  const problems: string[] = [];
  if (plan.version !== 2) problems.push(`Unsupported plan version ${plan.version}.`);
  if (plan.accountId !== context.accountId) problems.push("The plan was made for a different ChatGPT account.");
  const byId = new Map(context.chats.map((chat) => [chat.id, chat]));
  const projects = new Map(context.projects.map((project) => [project.id, project]));
  const protect = { ...context.protect, ...plan.protect };
  for (const [id, entry] of Object.entries(plan.protect)) {
    const chat = byId.get(id);
    if (!chat) problems.push(`Protect “${entry.title}”: chat ${id} isn't in the loaded list.`);
  }
  for (const [id, mark] of Object.entries(plan.marks)) {
    const chat = byId.get(id);
    const label = `${ACTION_LABELS[mark.action]} “${mark.title}”`;
    if (!chat) {
      problems.push(`${label}: chat ${id} isn't in the loaded list.`);
      continue;
    }
    if (chat.title !== mark.title) {
      problems.push(`${label}: the chat is now titled “${chat.title}”, so the plan is stale.`);
      continue;
    }
    const reason = whyNot(chat, mark.action, true, protect);
    if (reason) problems.push(`${label}: ${reason}`);
    if (mark.action === "rename" && !mark.newTitle?.trim()) problems.push(`${label}: the new title is empty.`);
    if (mark.action === "move" && mark.project !== "" && !projects.has(mark.project)) {
      problems.push(`${label}: project ${mark.project} doesn't exist.`);
    }
  }
  if (problems.length) return { ok: false, problems };
  const marks: Record<string, Mark> = {};
  for (const [id, mark] of Object.entries(plan.marks)) {
    marks[id] = {
      ...mark,
      newTitle: mark.action === "rename" ? mark.newTitle : null,
      project: mark.action === "move" ? mark.project : "",
      projectName: mark.action === "move" ? (projects.get(mark.project)?.name ?? "") : "",
    };
  }
  return { ok: true, marks, protect: { ...plan.protect } };
}

export function fileStamp(atMs: number): string {
  const date = new Date(atMs);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-${two(date.getHours())}-${two(date.getMinutes())}`;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
