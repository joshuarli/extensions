import { Schema } from "effect";
import { CONFIG } from "./api.ts";
import { TriageError } from "./errors.ts";
import {
  ACTION_LABELS,
  buildJobs,
  createJournal,
  fileStamp,
  isUntitled,
  probeFromDetail,
  requestBodyFor,
  whyNot,
  type Action,
  type Chat,
  type Conversation,
  type Job,
  type Journal,
  type Project,
  type RunStatus,
} from "./model.ts";
import {
  ChatListSchema,
  ConversationProbeSchema,
  ConversationSchema,
  ProjectListSchema,
  SessionSchema,
  decodeApiResponse,
  decodeValue,
  type ApiRequest,
  type FailurePayload,
} from "./messages.ts";
import { QueueRunner, clampGap, type QueueTransport } from "./queue.ts";
import { requiresTypedConfirmation } from "./safety.ts";
import { createChromeJournalStore } from "./storage.ts";

type Props = Record<string, string | number | boolean | ((event: Event) => void) | null | undefined>;

function h(tag: string, props: Props | null, ...children: unknown[]): HTMLElement {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") element.className = String(value);
      else if (key === "text") element.textContent = String(value);
      else if (key.startsWith("on") && typeof value === "function") {
        element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key in element && typeof value !== "string") {
        (element as unknown as Record<string, unknown>)[key] = value;
      } else {
        element.setAttribute(key, value === true ? "" : String(value));
      }
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

const foundApp = document.querySelector<HTMLDivElement>("#app");
if (!foundApp) throw new Error("Missing #app element");
const app: HTMLDivElement = foundApp;

const store = createChromeJournalStore(chrome.storage);
const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let journal: Journal = createJournal();
let chats: Chat[] = [];
let projects: Project[] = [];
let tabId: number | null = null;
let scope: "active" | "archived" = "active";
let filter: "all" | "unorganized" | "projects" | "marked" = "all";
let projectFilter: string | null = null;
let search = "";
let focusId: string | null = null;
let selected = new Set<string>();
let compatOk = true;
let progress = "";
let activity: string[] = [];
let runner: QueueRunner | undefined;
let previewToken = 0;
let booting = true;
const previewCache = new Map<string, Conversation>();

const ACTIVE_STATUSES = new Set<RunStatus>(["backup", "saving", "running", "waiting", "verifying"]);
const FAILURE_KINDS: string[] = ["aborted", "offline", "auth", "cooldown", "ratelimit", "transient", "notfound", "http", "compat"];

function toast(message: string): void {
  activity.unshift(message);
  if (activity.length > 100) activity.pop();
  renderTopbar();
}

function nextRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function ensureTab(): Promise<number> {
  if (tabId != null) {
    const existing = await chrome.tabs.get(tabId).catch(() => null);
    if (existing) return tabId;
    tabId = null;
  }
  const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
  const id = tabs[0]?.id;
  if (id == null) throw new TriageError("offline", "Open chatgpt.com in a tab, sign in, then reload this dashboard.");
  tabId = id;
  return id;
}

async function send(request: ApiRequest): Promise<unknown> {
  const id = await ensureTab();
  return new Promise<unknown>((resolve, reject) => {
    chrome.tabs.sendMessage(id, request, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new TriageError("offline", chrome.runtime.lastError.message ?? "The ChatGPT tab did not answer."));
        return;
      }
      const decoded = decodeApiResponse(response);
      if (!decoded) {
        reject(new TriageError("http", "The content script returned an unexpected response."));
        return;
      }
      if (decoded.ok) {
        resolve(decoded.value);
        return;
      }
      const error = decoded.error as FailurePayload;
      const kind = FAILURE_KINDS.includes(error.kind) ? error.kind : "http";
      reject(new TriageError(kind as TriageError["kind"], error.message, error.until));
    });
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TriageError("aborted", "Stopped."));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort(): void {
      clearTimeout(timer);
      reject(new TriageError("aborted", "Stopped."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function persist(): Promise<void> {
  await store.save(journal);
}

async function loadChats(which: "active" | "archived"): Promise<Chat[]> {
  const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "list", scope: which });
  return decodeValue(ChatListSchema, value).map((chat) => ({ ...chat }));
}

async function loadProjects(): Promise<Project[]> {
  const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "projects" });
  return decodeValue(ProjectListSchema, value).map((project) => ({ ...project }));
}

interface QueueCounts {
  delete: number;
  archive: number;
  unarchive: number;
  rename: number;
  move: number;
  total: number;
}

function decodeConversation(value: unknown): Conversation {
  const decoded = decodeValue(ConversationSchema, value);
  return {
    title: decoded.title,
    search: decoded.search,
    messages: decoded.messages.map((message) => ({ ...message })),
  };
}

async function loadPreview(id: string): Promise<void> {
  const token = ++previewToken;
  const cached = previewCache.get(id);
  if (cached) {
    renderPreview(cached);
    return;
  }
  renderPreview(null);
  try {
    const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "conversation", id });
    const conversation = decodeConversation(value);
    previewCache.set(id, conversation);
    if (previewCache.size > 300) {
      const oldest = previewCache.keys().next().value;
      if (oldest != null) previewCache.delete(oldest);
    }
    if (token === previewToken) renderPreview(conversation);
  } catch (error) {
    if (token === previewToken) renderPreview(null, error instanceof Error ? error.message : String(error));
  }
}

const transport: QueueTransport = {
  async getConversation(id) {
    const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "conversation", id });
    return decodeConversation(value);
  },
  async writeChange(job) {
    await send({
      kind: "chatgpt/api",
      requestId: nextRequestId(),
      op: "change",
      id: job.id,
      runId: journal.run?.id ?? "",
      action: job.action,
      body: requestBodyFor(job) as Record<string, unknown>,
    });
  },
  async listActive() {
    const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "list", scope: "active" });
    return decodeValue(ChatListSchema, value).map((chat) => ({ ...chat }));
  },
  async probe(id) {
    const value = await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "detail", id });
    return decodeValue(ConversationProbeSchema, probeFromDetail(value));
  },
};

function makeRunner(): QueueRunner {
  return new QueueRunner({
    transport,
    journal,
    chats,
    now: () => Date.now(),
    sleep,
    persist: () => persist(),
    owner,
    onEvent: (event) => {
      if (event.type === "note" && event.message) toast(event.message);
      renderAll();
    },
  });
}

async function armRun(runId: string, jobs: readonly Job[]): Promise<void> {
  await send({
    kind: "chatgpt/api",
    requestId: nextRequestId(),
    op: "arm",
    runId,
    jobs: jobs.map((job) => ({ id: job.id, action: job.action })),
  });
}

async function disarmRun(runId: string): Promise<void> {
  try {
    await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "disarm", runId });
  } catch {
    return;
  }
}

async function startRun(jobs: Job[], backup: boolean): Promise<void> {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  journal.settings.backup = backup;
  await persist();
  runner = makeRunner();
  try {
    await armRun(runId, jobs);
  } catch (error) {
    toast(`Changes stayed disabled; nothing was sent. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  runner.start({ backup, runId });
}

async function resumeRun(): Promise<void> {
  const run = journal.run;
  if (!run) return;
  try {
    await armRun(run.id, run.jobs);
  } catch (error) {
    toast(`Changes stayed disabled; nothing was sent. ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  runner?.resume();
}

function visibleChats(): Chat[] {
  const archived = scope === "archived";
  const term = search.trim().toLowerCase();
  const rows = chats.filter((chat) => {
    if (chat.archived !== archived) return false;
    if (filter === "unorganized" && chat.projectId) return false;
    if (filter === "projects" && (!chat.projectId || (projectFilter && chat.projectId !== projectFilter))) return false;
    if (filter === "marked" && !journal.marks[chat.id]) return false;
    if (!term) return true;
    if (chat.title.toLowerCase().includes(term)) return true;
    const cached = previewCache.get(chat.id);
    return Boolean(cached?.search.includes(term));
  });
  return rows;
}

function queueCounts(): QueueCounts {
  const counts: QueueCounts = { delete: 0, archive: 0, unarchive: 0, rename: 0, move: 0, total: 0 };
  for (const [id, mark] of Object.entries(journal.marks)) {
    if (journal.protect[id]) continue;
    switch (mark.action) {
      case "delete": counts.delete += 1; break;
      case "archive": counts.archive += 1; break;
      case "unarchive": counts.unarchive += 1; break;
      case "rename": counts.rename += 1; break;
      case "move": counts.move += 1; break;
      case "protect": continue;
    }
    counts.total += 1;
  }
  return counts;
}

function badge(id: string): HTMLElement | null {
  const protection = journal.protect[id];
  if (protection) return h("span", { class: "badge protect", text: "Protected" });
  const mark = journal.marks[id];
  if (!mark) return null;
  const label = mark.action === "move" ? `Move → ${mark.projectName || "No Project"}` : ACTION_LABELS[mark.action];
  return h("span", { class: `badge ${mark.action}`, text: label });
}

function renderTopbar(): void {
  const counts = queueCounts();
  const run = journal.run;
  const statusText = run
    ? `${run.status} · ${run.i}/${run.jobs.length}${run.note ? ` · ${run.note}` : ""}`
    : activity[0] ?? (compatOk ? "Ready" : "Changes disabled: unfamiliar ChatGPT data");

  const buttons: HTMLElement[] = [];
  const disarmCurrent = (): void => {
    const id = journal.run?.id;
    if (id) void disarmRun(id);
  };
  if (run && ACTIVE_STATUSES.has(run.status)) {
    buttons.push(h("button", { onclick: () => runner?.pause("Paused by you."), text: "Pause" }));
    buttons.push(h("button", { class: "danger", onclick: () => { runner?.stop(); disarmCurrent(); }, text: "Stop" }));
  } else if (run?.status === "paused") {
    buttons.push(h("button", { class: "primary", onclick: () => void resumeRun(), text: "Resume" }));
    buttons.push(h("button", { onclick: () => { runner?.stop(); disarmCurrent(); }, text: "Stop" }));
    buttons.push(h("button", { class: "link", onclick: () => { runner?.dismiss(); disarmCurrent(); }, text: "Dismiss" }));
  } else if (run?.status === "saving") {
    buttons.push(h("button", { class: "primary", onclick: saveBackup, text: "Save backup & continue" }));
    buttons.push(h("button", { onclick: () => { runner?.stop(); disarmCurrent(); }, text: "Stop" }));
  } else {
    buttons.push(h("button", {
      class: "primary",
      disabled: counts.total === 0 || !compatOk,
      onclick: runQueue,
      text: "Run queue",
    }));
    buttons.push(h("button", { onclick: importPlan, text: "Import plan" }));
    buttons.push(h("button", { onclick: exportPlan, text: "Export plan" }));
    if (run && (run.status === "done" || run.status === "stopped")) {
      buttons.push(h("button", { class: "link", onclick: exportReport, text: "Export report" }));
      buttons.push(h("button", { class: "link", onclick: () => { runner?.dismiss(); disarmCurrent(); }, text: "Dismiss" }));
    }
  }

  app.replaceChildren(
    h("div", { class: "app" },
      h("div", { class: "topbar" },
        h("span", { class: "brand" }, h("span", { class: "mark", text: "◈" }), " ChatGPT Organizer"),
        h("span", { class: "counts", text: `${counts.total} queued · ${selected.size} selected` }),
        h("span", { class: "status", text: progress || statusText }),
        h("span", { class: "spacer" }),
        ...buttons,
      ),
      h("div", { class: "columns" }, renderFilters(), renderList(), renderPreviewColumn()),
      renderFooter(),
    ),
  );
}

function renderFilters(): HTMLElement {
  const all = chats.filter((chat) => chat.archived === (scope === "archived"));
  const options: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All conversations" },
    { key: "unorganized", label: "Unorganized" },
    { key: "projects", label: "In projects" },
    { key: "marked", label: "Marked" },
  ];
  return h("aside", { class: "col" },
    h("div", { class: "col-head" },
      h("div", { class: "col-title", text: "Filters" }),
      h("div", { class: "tools" },
        h("button", {
          class: scope === "active" ? "primary" : "",
          onclick: () => { scope = "active"; focusId = null; renderAll(); },
          text: "Active",
        }),
        h("button", {
          class: scope === "archived" ? "primary" : "",
          onclick: () => { scope = "archived"; focusId = null; renderAll(); },
          text: "Archived",
        }),
      ),
      h("input", {
        class: "search",
        type: "search",
        placeholder: "Search titles ( / )",
        value: search,
        oninput: (event) => { search = (event.target as HTMLInputElement).value; renderAll(); },
      }),
    ),
    h("div", { style: "padding:10px 12px" },
      h("div", { class: "filters" }, ...options.map((option) => {
        const count = option.key === "all" ? all.length
          : option.key === "unorganized" ? all.filter((chat) => !chat.projectId).length
          : option.key === "projects" ? all.filter((chat) => chat.projectId).length
          : all.filter((chat) => journal.marks[chat.id]).length;
        return h("button", {
          class: `filter ${filter === option.key ? "on" : ""}`,
          onclick: () => { filter = option.key; projectFilter = null; renderAll(); },
        }, h("span", { text: option.label }), h("span", { class: "n", text: String(count) }));
      })),
      h("div", { class: "projects" },
        h("div", { class: "label", text: "Projects" }),
        h("div", { class: "filters" },
          h("button", {
            class: `filter ${projectFilter === null && filter === "projects" ? "on" : ""}`,
            onclick: () => { filter = "projects"; projectFilter = null; renderAll(); },
          }, h("span", { text: "Any project" })),
          ...projects.map((project) => h("button", {
            class: `filter ${projectFilter === project.id ? "on" : ""}`,
            onclick: () => { filter = "projects"; projectFilter = project.id; renderAll(); },
          }, h("span", { text: project.name }))),
        ),
      ),
      h("div", { class: "projects" },
        h("div", { class: "label", text: "Selection" }),
        h("div", { class: "tools" },
          h("button", { onclick: selectAll, text: "Select all" }),
          h("button", { onclick: invertSelection, text: "Invert" }),
          h("button", { onclick: clearSelection, text: "Clear" }),
        ),
      ),
    ),
  );
}

function renderList(): HTMLElement {
  const rows = visibleChats();
  if (!rows.length) {
    return h("section", { class: "col" },
      h("div", { class: "col-head" }, h("div", { class: "col-title", text: "Conversations" })),
      h("div", { class: "empty", text: search ? "No conversations match this search." : "No conversations here." }),
    );
  }
  return h("section", { class: "col" },
    h("div", { class: "col-head" },
      h("div", { class: "col-title", text: `Conversations · ${rows.length}` }),
      h("div", { class: "tools" },
        h("button", { onclick: () => markSelection("delete"), text: "Delete" }),
        h("button", { onclick: () => markSelection("archive"), text: "Archive" }),
        h("button", { onclick: () => markSelection("unarchive"), text: "Unarchive" }),
        h("button", { onclick: () => markSelection("rename"), text: "Rename" }),
        h("button", { onclick: () => markSelection("move"), text: "Move" }),
        h("button", { onclick: () => markSelection("protect"), text: "Protect" }),
        h("button", { onclick: clearMarks, text: "Clear marks" }),
      ),
    ),
    h("div", { class: "list" }, ...rows.map((chat) => {
      const mark = journal.marks[chat.id];
      return h("div", {
        class: `row ${focusId === chat.id ? "focus" : ""}`,
        onclick: (event) => {
          if ((event.target as HTMLElement).closest("input")) return;
          if ((event as MouseEvent).shiftKey && focusId) selectRange(focusId, chat.id);
          focusChat(chat.id);
        },
      },
        h("input", {
          type: "checkbox",
          checked: selected.has(chat.id),
          onclick: (event) => { event.stopPropagation(); toggleSelection(chat.id); },
        }),
        h("div", { class: "title" },
          h("span", { text: chat.title || "Untitled" }),
          isUntitled(chat.title) ? h("span", { class: "badge", text: "untitled" }) : null,
          badge(chat.id),
          mark?.action === "move" ? h("span", { class: "meta", text: ` → ${mark.projectName || "No Project"}` }) : null,
        ),
        h("div", { class: "meta", text: chat.createdMs ? new Date(chat.createdMs).toLocaleDateString() : "—" }),
      );
    })),
  );
}

function renderPreviewColumn(): HTMLElement {
  const run = journal.run;
  const results = run?.results ?? [];
  return h("section", { class: "col" },
    h("div", { class: "col-head" }, h("div", { class: "col-title", text: "Preview & review" })),
    renderPreviewBody(),
    h("div", { class: "preview" },
      h("div", { class: "queued" },
        h("h3", { text: "Queued changes" }),
        results.length
          ? h("div", {}, ...results.map((result) => h("div", { class: `result ${result.status}` },
            h("span", { class: "s", text: result.status }),
            " ", result.action, " ", result.title || result.id,
            result.note ? h("div", { class: "note", text: result.note }) : null,
          )))
          : h("div", { class: "note", text: "Mark a chat to queue a change, then run the queue." }),
      ),
      h("div", { class: "queued" },
        h("h3", { text: "Keyboard" }),
        h("div", { class: "note" },
          h("span", { class: "kbd", text: "↑↓" }), " move · ",
          h("span", { class: "kbd", text: "X" }), " select · ",
          h("span", { class: "kbd", text: "D/A/U/R/M/P/C" }), " mark · ",
          h("span", { class: "kbd", text: "/" }), " search",
        ),
      ),
    ),
  );
}

function renderPreviewBody(): HTMLElement {
  const id = focusId;
  if (!id) return h("div", { class: "preview empty", text: "Select a conversation to read it before you decide." });
  return h("div", { id: "preview-slot", class: "preview" }, h("div", { class: "note", text: "Loading conversation…" }));
}

function renderPreview(conversation: Conversation | null, error?: string): void {
  const slot = document.querySelector<HTMLElement>("#preview-slot");
  if (!slot) return;
  if (error) {
    slot.replaceChildren(h("div", { class: "err", text: `Couldn't load this conversation: ${error}` }));
    return;
  }
  if (!conversation) {
    slot.replaceChildren(h("div", { class: "note", text: "This conversation could not be read. It will not be deleted until a backup succeeds." }));
    return;
  }
  slot.replaceChildren(
    h("h2", { text: conversation.title || "Untitled" }),
    h("div", { class: "meta", text: `${conversation.messages.length} messages` }),
    ...conversation.messages.map((message) => h("div", { class: `msg ${message.role}` },
      h("div", { class: "who", text: message.role === "user" ? "You" : "ChatGPT" }),
      h("div", { class: "body", text: message.text }),
    )),
  );
}

function renderFooter(): HTMLElement {
  return h("footer", { class: "footer" },
    h("span", { text: activity.slice(0, 3).join(" | ") || "No activity yet." }),
  );
}

function renderAll(): void {
  renderTopbar();
}

function focusChat(id: string): void {
  focusId = id;
  renderAll();
  void loadPreview(id);
}

function toggleSelection(id: string): void {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  renderAll();
}

function clearSelection(): void {
  selected = new Set();
  renderAll();
}

function selectAll(): void {
  selected = new Set(visibleChats()
    .filter((chat) => !journal.protect[chat.id] && (!chat.pinned || journal.settings.pinnedInSelectAll))
    .map((chat) => chat.id));
  renderAll();
}

function invertSelection(): void {
  const next = new Set<string>();
  for (const chat of visibleChats()) {
    if (!journal.protect[chat.id] && !selected.has(chat.id)) next.add(chat.id);
  }
  selected = next;
  renderAll();
}

function selectRange(fromId: string, toId: string): void {
  const rows = visibleChats().map((chat) => chat.id);
  const from = rows.indexOf(fromId);
  const to = rows.indexOf(toId);
  if (from < 0 || to < 0) return;
  for (const id of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
    if (!journal.protect[id]) selected.add(id);
  }
  renderAll();
}

function clearMarks(): void {
  const targets = selected.size ? selected : focusId ? new Set([focusId]) : new Set<string>();
  for (const id of targets) delete journal.marks[id];
  void persist();
  renderAll();
}

function setMark(id: string, action: Action, options: { newTitle?: string; project?: string; projectName?: string } = {}): void {
  if (action === "protect") {
    if (journal.protect[id]) delete journal.protect[id];
    else journal.protect[id] = { title: chats.find((chat) => chat.id === id)?.title ?? id, at: Date.now() };
    void persist();
    renderAll();
    return;
  }
  const chat = chats.find((candidate) => candidate.id === id);
  const reason = chat ? whyNot(chat, action, compatOk, journal.protect) : null;
  if (reason) {
    toast(reason);
    return;
  }
  journal.marks[id] = {
    action,
    title: chat?.title ?? "",
    newTitle: options.newTitle ?? null,
    project: options.project ?? "",
    projectName: options.projectName ?? "",
    at: Date.now(),
  };
  void persist();
  renderAll();
}

function markSelection(action: Action): void {
  const targets = selected.size ? [...selected] : focusId ? [focusId] : [];
  if (!targets.length) {
    toast("Select or focus a conversation first.");
    return;
  }
  if (action === "rename") {
    const first = targets[0];
    if (!first) return;
    const current = chats.find((chat) => chat.id === first)?.title ?? "";
    openPrompt("Rename conversation", current, (value) => {
      if (!value.trim()) return;
      for (const id of targets) setMark(id, "rename", { newTitle: value.trim() });
      if (focusId && targets.length === 1) moveFocus(1);
    });
    return;
  }
  if (action === "move") {
    openMove(targets);
    return;
  }
  for (const id of targets) setMark(id, action);
  if (focusId && targets.length === 1 && action !== "protect") moveFocus(1);
}

function moveFocus(delta: number, extend = false): void {
  const rows = visibleChats().map((chat) => chat.id);
  if (!rows.length) return;
  const current = focusId ? rows.indexOf(focusId) : -1;
  const next = rows[Math.min(rows.length - 1, Math.max(0, current + delta))];
  if (next == null) return;
  if (extend && focusId) selectRange(focusId, next);
  focusChat(next);
}

function openModal(titleText: string, body: HTMLElement, buttons: HTMLElement[], shouldClose?: () => boolean): void {
  const veil = h("div", { class: "veil" },
    h("div", { class: "modal" },
      h("h2", { text: titleText }),
      body,
      h("div", { class: "buttons" }, ...buttons),
    ),
  );
  document.body.append(veil);
  const close = (): void => veil.remove();
  veil.addEventListener("click", (event) => {
    if (event.target === veil) close();
  });
  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (!shouldClose || shouldClose()) close();
    });
  }
}

function openPrompt(titleText: string, initial: string, onConfirm: (value: string) => void): void {
  const input = h("input", { type: "text", value: initial }) as HTMLInputElement;
  const body = h("div", { class: "field" }, h("label", { text: "New title" }), input);
  const confirm = h("button", { class: "primary", text: "Queue rename", onclick: () => onConfirm(input.value) });
  openModal(titleText, body, [h("button", { text: "Cancel" }), confirm]);
  input.focus();
  input.select();
}

function openMove(targets: string[]): void {
  const select = h("select", {},
    h("option", { value: "", text: "No Project" }),
    ...projects.map((project) => h("option", { value: project.id, text: project.name })),
  ) as HTMLSelectElement;
  const body = h("div", { class: "field" },
    h("label", { text: `Move ${targets.length} ${targets.length === 1 ? "chat" : "chats"} to` }),
    select,
  );
  const confirm = h("button", {
    class: "primary",
    text: "Queue move",
    onclick: () => {
      const id = select.value;
      const name = projects.find((project) => project.id === id)?.name ?? "";
      for (const target of targets) setMark(target, "move", { project: id, projectName: name });
    },
  });
  openModal("Move to project", body, [h("button", { text: "Cancel" }), confirm]);
}

function runQueue(): void {
  const jobs = buildJobs(journal, chats);
  if (!jobs.length) {
    toast("Nothing is queued.");
    return;
  }
  const deletes = jobs.filter((job) => job.action === "delete").length;
  const body = h("div", {},
    h("p", { text: `${jobs.length} ${jobs.length === 1 ? "change" : "changes"} will run one at a time, with a ${clampGap(journal.settings.gap, CONFIG)} second gap.` }),
    deletes ? h("p", { class: "err", text: `${deletes} ${deletes === 1 ? "chat" : "chats"} will be deleted permanently.` }) : null,
    requiresTypedConfirmation(deletes, CONFIG.typeToConfirm) ? h("div", { class: "field" },
      h("label", { text: `Type ${deletes} to confirm deletion` }),
      h("input", { id: "confirm-count", type: "text", placeholder: String(deletes) }),
    ) : null,
    h("div", { class: "field" },
      h("label", {},
        h("input", { id: "backup-toggle", type: "checkbox", checked: journal.settings.backup }),
        " Back up every chat before deleting it",
      ),
    ),
    h("p", { class: "note", text: "Changes stay disabled until this exact list is authorized. Each chat is authorized once; anything else is refused." }),
  );
  const confirmed = (): boolean => {
    const input = document.querySelector<HTMLInputElement>("#confirm-count");
    return !input || input.value.trim() === String(deletes);
  };
  const confirm = h("button", {
    class: "primary",
    text: "Run",
    onclick: () => {
      if (!confirmed()) return;
      const backup = document.querySelector<HTMLInputElement>("#backup-toggle")?.checked ?? false;
      void startRun(jobs, backup);
    },
  });
  openModal("Review and run queue", body, [h("button", { text: "Cancel" }), confirm], confirmed);
}

function saveBackup(): void {
  const text = runner?.backupText() ?? "";
  if (!text) return;
  const stamp = fileStamp(Date.now());
  download(`chatgpt-triage-backup-${stamp}.md`, text, "text/markdown");
  runner?.acknowledgeBackupSaved(`chatgpt-triage-backup-${stamp}.md`);
}

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const PlanSchema = Schema.Struct({
  version: Schema.Number,
  marks: Schema.Record(Schema.String, Schema.Struct({
    action: Schema.Literals(["delete", "archive", "unarchive", "rename", "move"]),
    title: Schema.String,
    newTitle: Schema.Union([Schema.String, Schema.Null]),
    project: Schema.String,
    projectName: Schema.String,
    at: Schema.Number,
  })),
  protect: Schema.Record(Schema.String, Schema.Struct({ title: Schema.String, at: Schema.Number })),
});

function importPlan(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const plan = decodeValue(PlanSchema, JSON.parse(text) as unknown);
        journal.marks = { ...journal.marks, ...plan.marks };
        journal.protect = { ...journal.protect, ...plan.protect };
        void persist();
        renderAll();
        toast(`Imported ${Object.keys(plan.marks).length} planned changes.`);
      } catch (error) {
        toast(`Could not import that plan: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
  input.click();
}

function exportPlan(): void {
  const plan = { version: 1, marks: journal.marks, protect: journal.protect };
  download(`chatgpt-organizer-plan-${fileStamp(Date.now())}.json`, JSON.stringify(plan, null, 2), "application/json");
}

function exportReport(): void {
  const run = journal.run;
  if (!run) return;
  download(`chatgpt-organizer-report-${fileStamp(Date.now())}.json`, JSON.stringify(run.results, null, 2), "application/json");
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

function onKey(event: KeyboardEvent): void {
  if (document.querySelector(".veil")) return;
  if (event.key === "/" && !isTyping(event.target)) {
    event.preventDefault();
    document.querySelector<HTMLInputElement>(".search")?.focus();
    return;
  }
  if (isTyping(event.target)) return;
  const key = event.key;
  if (key === "ArrowDown" || key.toLowerCase() === "j") {
    event.preventDefault();
    moveFocus(1, event.shiftKey);
  } else if (key === "ArrowUp" || key.toLowerCase() === "k") {
    event.preventDefault();
    moveFocus(-1, event.shiftKey);
  } else if (key === " " || key.toLowerCase() === "x") {
    event.preventDefault();
    if (focusId) toggleSelection(focusId);
  } else if (key === "Escape") {
    clearSelection();
  } else if (["d", "a", "u", "r", "m", "p", "c"].includes(key.toLowerCase())) {
    event.preventDefault();
    if (!focusId) return;
    const action = { d: "delete", a: "archive", u: "unarchive", r: "rename", m: "move", p: "protect", c: "clear" }[key.toLowerCase()];
    if (action === "clear") {
      delete journal.marks[focusId];
      void persist();
      renderAll();
      return;
    }
    if (action === "rename" || action === "move") markSelection(action);
    else setMark(focusId, action as Action);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return false;
  const record = message as { kind?: unknown; found?: unknown; total?: unknown; waiting?: unknown };
  if (record.kind !== "chatgpt/list-progress" || !booting) return false;
  const found = Number(record.found ?? 0);
  const total = typeof record.total === "number" ? record.total : null;
  progress = record.waiting === true
    ? "Waiting for ChatGPT…"
    : total !== null && found >= total
      ? ""
      : `Loading ${found}${total !== null ? ` of ${total}` : ""} chats…`;
  renderTopbar();
  return false;
});

document.addEventListener("keydown", onKey);

async function boot(): Promise<void> {
  try {
    await ensureTab();
    const session = decodeValue(SessionSchema, await send({ kind: "chatgpt/api", requestId: nextRequestId(), op: "session" }));
    const accountId = session.userId ?? "default";
    journal = await store.load(accountId);
    journal.accountId = accountId;
    journal.settings.gap = clampGap(Number(journal.settings.gap) || CONFIG.gapDefault, CONFIG);
    if (journal.run && ACTIVE_STATUSES.has(journal.run.status) && journal.run.owner !== owner) {
      journal.run.status = "paused";
      journal.run.note = "Interrupted by a restart. Review and resume deliberately.";
      await persist();
    }
    progress = "Loading conversations…";
    renderAll();
    chats = await loadChats("active");
    try {
      projects = await loadProjects();
    } catch {
      projects = [];
      toast("Couldn't load projects; moving chats is unavailable this session.");
    }
    if (!chats.some((chat) => chat.archived)) {
      try {
        const archived = await loadChats("archived");
        chats.push(...archived);
      } catch {
        toast("Couldn't load the archived list.");
      }
    }
    compatOk = true;
    progress = "";
    booting = false;
    focusId = visibleChats()[0]?.id ?? null;
    runner = makeRunner();
    renderAll();
    if (focusId) void loadPreview(focusId);
  } catch (error) {
    const failure = error instanceof TriageError ? error : null;
    if (failure?.kind === "compat") compatOk = false;
    progress = "";
    booting = false;
    toast(failure?.message ?? (error instanceof Error ? error.message : String(error)));
    renderAll();
  }
}

void boot();
