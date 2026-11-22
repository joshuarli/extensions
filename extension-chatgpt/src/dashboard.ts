import { Schema } from "effect";
import { CONFIG } from "./api.ts";
import { failureOf, isFailureKind, TriageError } from "./errors.ts";
import {
  ACTION_LABELS,
  BACKUP_EXCLUDES,
  buildJobs,
  commandOf,
  fileStamp,
  isRunActive,
  isUntitled,
  recoverInterrupted,
  runControls,
  sha256Hex,
  validatePlan,
  whyNot,
  type Action,
  type Chat,
  type Conversation,
  type Job,
  type Journal,
  type Mark,
  type Project,
  type Run,
} from "./model.ts";
import {
  ChatListSchema,
  ConversationProbeSchema,
  ConversationSchema,
  LEASE_PORT_PREFIX,
  ProjectListSchema,
  SessionSchema,
  decodeApiResponse,
  decodeListProgress,
  decodeValue,
  type ApiRequest,
} from "./messages.ts";
import { QueueRunner, clampGap, type BackupProof, type QueueTransport } from "./queue.ts";
import { requiresTypedConfirmation } from "./safety.ts";
import { createChromeJournalStore, createSerialPersist } from "./storage.ts";

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

const LOCK_NAME = "chatgpt-organizer:dashboard";
const store = createChromeJournalStore(chrome.storage);

let journal: Journal | null = null;
let accountId: string | null = null;
const chats: Chat[] = [];
let projects: Project[] = [];
let tabId: number | null = null;
let scope: "active" | "archived" = "active";
let filter: "all" | "unorganized" | "projects" | "marked" = "all";
let projectFilter: string | null = null;
let search = "";
let focusId: string | null = null;
let selected = new Set<string>();
let compatOk = false;
let progress = "";
let inventoryNote = "";
let blocked = "";
const activity: string[] = [];
let runner: QueueRunner | null = null;
let lease: { runId: string; id: string; port: chrome.runtime.Port } | null = null;
let arming = false;
const previewCache = new Map<string, Conversation>();
const previewErrors = new Map<string, string>();
let previewTimer: ReturnType<typeof setTimeout> | null = null;

const persistJournal = createSerialPersist(store, () => {
  if (!journal) throw new TriageError("compat", "No journal is loaded.");
  return journal;
});

function persistQuietly(): void {
  void persistJournal().catch((error: unknown) => {
    toast(`Couldn't save your marks: ${failureOf(error).message}`);
  });
}

// ---------- layout (built once; regions update in place) ----------

const ui = {
  counts: h("span", { class: "counts" }),
  status: h("span", { class: "status", role: "status" }),
  actions: h("span", { class: "actions" }),
  scopes: h("div", { class: "tools" }),
  search: h("input", {
    class: "search",
    type: "search",
    placeholder: "Search titles ( / )",
    "aria-label": "Search conversations",
  }) as HTMLInputElement,
  filters: h("div", { class: "filters" }),
  projects: h("div", { class: "filters" }),
  listTitle: h("div", { class: "col-title" }),
  list: h("div", { class: "list", role: "listbox", "aria-multiselectable": "true" }),
  preview: h("div", { class: "preview", id: "preview" }),
  queue: h("div", { class: "queued-body" }),
  footer: h("footer", { class: "footer" }),
};

type Region = "toolbar" | "filters" | "list" | "preview" | "queue" | "footer";
const dirty = new Set<Region>();
let flushQueued = false;

function invalidate(...regions: Region[]): void {
  for (const region of regions) dirty.add(region);
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(flush);
}

function invalidateAll(): void {
  invalidate("toolbar", "filters", "list", "preview", "queue", "footer");
}

function flush(): void {
  flushQueued = false;
  const regions = new Set(dirty);
  dirty.clear();
  if (regions.has("toolbar")) renderToolbar();
  if (regions.has("filters")) renderFilters();
  if (regions.has("list")) renderList();
  if (regions.has("preview")) renderPreview();
  if (regions.has("queue")) renderQueue();
  if (regions.has("footer")) renderFooter();
}

function buildLayout(): void {
  ui.search.addEventListener("input", () => {
    search = ui.search.value;
    viewChanged();
  });
  const markButtons = (["delete", "archive", "unarchive", "rename", "move", "protect"] as const).map((action) =>
    h("button", { onclick: () => markSelection(action), text: ACTION_LABELS[action] }));
  app.replaceChildren(
    h("div", { class: "app" },
      h("div", { class: "topbar" },
        h("span", { class: "brand" }, h("span", { class: "mark", text: "◈" }), " ChatGPT Organizer"),
        ui.counts,
        ui.status,
        h("span", { class: "spacer" }),
        ui.actions,
      ),
      h("div", { class: "columns" },
        h("aside", { class: "col" },
          h("div", { class: "col-head" }, h("div", { class: "col-title", text: "Filters" }), ui.scopes, ui.search),
          h("div", { class: "side" },
            ui.filters,
            h("div", { class: "projects" }, h("div", { class: "label", text: "Projects" }), ui.projects),
            h("div", { class: "projects" },
              h("div", { class: "label", text: "Selection" }),
              h("div", { class: "tools" },
                h("button", { onclick: selectAll, text: "Select all" }),
                h("button", { onclick: invertSelection, text: "Invert" }),
                h("button", { onclick: clearSelection, text: "Clear" }),
              ),
            ),
          ),
        ),
        h("section", { class: "col list-col" },
          h("div", { class: "col-head" },
            ui.listTitle,
            h("div", { class: "tools" }, ...markButtons, h("button", { onclick: clearMarks, text: "Clear marks" })),
          ),
          ui.list,
        ),
        h("section", { class: "col" },
          h("div", { class: "col-head" }, h("div", { class: "col-title", text: "Preview & review" })),
          ui.preview,
          h("div", { class: "preview" },
            h("div", { class: "queued" }, h("h3", { text: "Queue" }), ui.queue),
            h("div", { class: "queued" },
              h("h3", { text: "Keyboard" }),
              h("div", { class: "note" },
                h("span", { class: "kbd", text: "↑↓ j k" }), " move · ",
                h("span", { class: "kbd", text: "X" }), " select · ",
                h("span", { class: "kbd", text: "D A U R M P C" }), " mark · ",
                h("span", { class: "kbd", text: "/" }), " search · ",
                h("span", { class: "kbd", text: "Q" }), " review & run, or pause",
              ),
            ),
          ),
        ),
      ),
      ui.footer,
    ),
  );
}

function toast(message: string): void {
  activity.unshift(message);
  if (activity.length > 100) activity.pop();
  invalidate("toolbar", "footer");
}

// ---------- transport to the content script ----------

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

type RequestBody = ApiRequest extends infer R ? R extends ApiRequest ? Omit<R, "kind" | "requestId"> : never : never;

// One ChatGPT request, including its pacing slot, finishes well inside this. A change that
// doesn't answer in time has an unknown outcome and is reconciled like a lost response.
const SINGLE_REQUEST_TIMEOUT_MS = 90_000;

function signedIn(): string {
  if (!accountId) throw new TriageError("auth", "The signed-in account isn't known yet.");
  return accountId;
}

async function send(body: RequestBody): Promise<unknown> {
  const id = await ensureTab();
  const request = { kind: "chatgpt/api", requestId: nextRequestId(), ...body } as ApiRequest;
  return new Promise<unknown>((resolve, reject) => {
    const timer = request.op === "list"
      ? null
      : setTimeout(() => reject(new TriageError("offline", "The ChatGPT tab stopped answering.")), SINGLE_REQUEST_TIMEOUT_MS);
    chrome.tabs.sendMessage(id, request, (response: unknown) => {
      if (timer) clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new TriageError("offline", chrome.runtime.lastError.message ?? "The ChatGPT tab did not answer."));
        return;
      }
      const decoded = decodeApiResponse(response);
      if (!decoded) {
        reject(new TriageError("offline", "The ChatGPT tab returned an unexpected response."));
        return;
      }
      if (decoded.ok) {
        resolve(decoded.value);
        return;
      }
      const error = decoded.error;
      const kind = error && isFailureKind(error.kind) ? error.kind : "http";
      reject(new TriageError(kind, error?.message ?? "The change failed.", error?.until ?? 0));
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

async function loadChats(which: "active" | "archived"): Promise<{ chats: Chat[]; complete: boolean; total: number | null }> {
  const value = decodeValue(ChatListSchema, await send({ op: "list", accountId: signedIn(), scope: which }));
  return { chats: value.chats.map((chat) => ({ ...chat })), complete: value.complete, total: value.total };
}

function decodeConversation(value: unknown): Conversation {
  const decoded = decodeValue(ConversationSchema, value);
  return { title: decoded.title, search: decoded.search, messages: decoded.messages.map((message) => ({ ...message })) };
}

const transport: QueueTransport = {
  async fetchRecord(id) {
    return send({ op: "record", accountId: signedIn(), id });
  },
  async writeChange(run, job) {
    const current = lease;
    if (current?.runId !== run.id) throw new TriageError("auth", "This run's lease closed. No change was sent.");
    try {
      await send({ op: "change", runId: run.id, leaseId: current.id, accountId: run.accountId, id: job.id });
    } catch (error) {
      if (failureOf(error).kind === "offline" && lease === current) closeLease();
      throw error;
    }
  },
  async listActive() {
    return loadChats("active");
  },
  async probe(id) {
    return decodeValue(ConversationProbeSchema, await send({ op: "probe", accountId: signedIn(), id }));
  },
};

// ---------- run lease and arming ----------

function closeLease(): void {
  const current = lease;
  lease = null;
  current?.port.disconnect();
}

async function openLease(runId: string): Promise<void> {
  if (lease?.runId === runId) return;
  closeLease();
  const id = await ensureTab();
  const leaseId = crypto.randomUUID();
  const port = chrome.tabs.connect(id, { name: `${LEASE_PORT_PREFIX}${runId}:${leaseId}` });
  await new Promise<void>((resolve, reject) => {
    const fail = (error: TriageError): void => {
      port.disconnect();
      reject(error);
    };
    const timer = setTimeout(() => fail(new TriageError("offline", "The ChatGPT tab didn't answer.")), 5000);
    port.onMessage.addListener(function ready() {
      clearTimeout(timer);
      port.onMessage.removeListener(ready);
      resolve();
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      fail(new TriageError("offline", "The ChatGPT tab closed the connection. Reload it, then try again."));
    });
  });
  lease = { runId, id: leaseId, port };
  port.onDisconnect.addListener(() => {
    if (lease?.port !== port) return;
    lease = null;
    if (runner?.isActive()) void runner.pause("The ChatGPT tab closed or reloaded, so changes were switched off. Resume to re-check and continue.");
  });
}

async function arm(run: { id: string; accountId: string; jobs: readonly Job[] }): Promise<void> {
  await openLease(run.id);
  if (lease?.runId !== run.id) throw new TriageError("auth", "This run's lease closed.");
  await send({ op: "arm", runId: run.id, leaseId: lease.id, accountId: run.accountId, commands: run.jobs.map(commandOf) });
}

function makeRunner(loaded: Journal): QueueRunner {
  return new QueueRunner({
    transport,
    journal: loaded,
    chats,
    now: () => Date.now(),
    sleep,
    persist: persistJournal,
    onEvent: (event) => {
      if (event.type === "note" && event.message) toast(event.message);
      const run = loaded.run;
      if (run && !isRunActive(run) && lease?.runId === run.id) closeLease();
      invalidateAll();
    },
  });
}

async function startRun(jobs: Job[], options: { backup: boolean; acceptIncomplete: boolean; gap: number }): Promise<void> {
  if (!journal || !runner || arming) return;
  arming = true;
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  journal.settings.backup = options.backup;
  journal.settings.gap = clampGap(options.gap, CONFIG);
  try {
    await persistJournal();
    await arm({ id: runId, accountId: journal.accountId, jobs });
    await runner.start(jobs, { runId, backup: options.backup, acceptIncomplete: options.acceptIncomplete });
  } catch (error) {
    closeLease();
    toast(`Changes stayed switched off; nothing was sent. ${failureOf(error).message}`);
  } finally {
    arming = false;
  }
}

async function resumeRun(): Promise<void> {
  const run = journal?.run;
  if (!run || !runner || run.status !== "paused" || arming) return;
  arming = true;
  try {
    if (run.phase !== "verify") await arm(run);
    if (journal?.run === run && run.status === "paused") await runner.resume();
    else if (lease?.runId === run.id) closeLease();
  } catch (error) {
    closeLease();
    toast(`Changes stayed switched off; nothing was sent. ${failureOf(error).message}`);
  } finally {
    arming = false;
  }
}

async function stopRun(): Promise<void> {
  const run = journal?.run;
  if (!run || !runner) return;
  await runner.stop();
}

async function dismissRun(): Promise<void> {
  const run = journal?.run;
  if (!run || !runner) return;
  await runner.dismiss();
}

// ---------- view state ----------

function visibleChats(): Chat[] {
  const archived = scope === "archived";
  const term = search.trim().toLowerCase();
  const marks = journal?.marks ?? {};
  return chats.filter((chat) => {
    if (chat.archived !== archived) return false;
    if (filter === "unorganized" && chat.projectId) return false;
    if (filter === "projects" && (!chat.projectId || (projectFilter && chat.projectId !== projectFilter))) return false;
    if (filter === "marked" && !marks[chat.id]) return false;
    if (!term) return true;
    if (chat.title.toLowerCase().includes(term)) return true;
    return Boolean(previewCache.get(chat.id)?.search.includes(term));
  });
}

// A selection never reaches chats the current view hides.
function viewChanged(): void {
  const visible = new Set(visibleChats().map((chat) => chat.id));
  const hidden = [...selected].filter((id) => !visible.has(id));
  if (hidden.length) {
    for (const id of hidden) selected.delete(id);
    toast(`${hidden.length} selected ${hidden.length === 1 ? "chat is" : "chats are"} hidden by this view and ${hidden.length === 1 ? "was" : "were"} deselected.`);
  }
  if (focusId && !visible.has(focusId)) focusId = null;
  invalidate("toolbar", "filters", "list", "preview");
}

function queueCount(): number {
  if (!journal) return 0;
  return Object.values(journal.marks).filter((mark) => mark.action !== "protect").length;
}

function changeLabel(mark: Pick<Mark, "action" | "newTitle" | "projectName">): string {
  if (mark.action === "move") return `Move → ${mark.projectName || "No Project"}`;
  if (mark.action === "rename") return `Rename → “${mark.newTitle ?? ""}”`;
  return ACTION_LABELS[mark.action];
}

// ---------- toolbar ----------

let toolbarKey = "";

function renderToolbar(): void {
  const run = journal?.run ?? null;
  const controls = runner ? runControls(run) : "idle";
  const total = queueCount();
  ui.counts.textContent = `${total} queued · ${selected.size} selected`;
  ui.status.textContent = blocked || progress || statusText(run) || activity[0] || inventoryNote || (compatOk ? "Ready" : "");
  const canRun = Boolean(journal && runner && compatOk && total > 0);
  const verifyOnly = run?.phase === "verify";
  const key = `${controls}|${canRun}|${journal ? 1 : 0}|${runner?.canDismiss() ? 1 : 0}|${verifyOnly}`;
  if (key === toolbarKey) return;
  toolbarKey = key;
  const buttons: HTMLElement[] = [];
  switch (controls) {
    case "working":
      buttons.push(h("button", { onclick: () => void runner?.pause("Paused by you."), text: "Pause" }));
      buttons.push(h("button", { class: "danger", onclick: () => void stopRun(), text: "Stop" }));
      break;
    case "save-backup":
      buttons.push(h("button", { class: "primary", onclick: () => void saveBackup(), text: "Save backup & continue" }));
      buttons.push(h("button", { class: "danger", onclick: () => void stopRun(), text: "Stop" }));
      break;
    case "paused":
      buttons.push(h("button", { class: "primary", onclick: () => void resumeRun(), text: verifyOnly ? "Retry verification" : "Resume" }));
      buttons.push(h("button", { class: "danger", onclick: () => void stopRun(), text: "Stop" }));
      if (runner?.canDismiss()) buttons.push(h("button", { class: "link", onclick: () => void dismissRun(), text: "Dismiss" }));
      break;
    case "idle":
    case "finished":
      buttons.push(h("button", { class: "primary", disabled: !canRun, onclick: openReview, text: "Run queue" }));
      buttons.push(h("button", { disabled: !journal, onclick: importPlan, text: "Import plan" }));
      buttons.push(h("button", { disabled: !journal, onclick: exportPlan, text: "Export plan" }));
      if (controls === "finished") {
        buttons.push(h("button", { class: "link", onclick: exportReport, text: "Export report" }));
        buttons.push(h("button", { class: "link", onclick: () => void dismissRun(), text: "Dismiss" }));
      }
      break;
  }
  ui.actions.replaceChildren(...buttons);
}

function statusText(run: Run | null): string {
  if (!run) return "";
  const where = `${run.status} · ${Math.min(run.i, run.jobs.length)}/${run.jobs.length}`;
  return run.note ? `${where} · ${run.note}` : where;
}

// ---------- filters ----------

function renderFilters(): void {
  ui.scopes.replaceChildren(
    h("button", { class: scope === "active" ? "primary" : "", onclick: () => setScope("active"), text: "Active" }),
    h("button", { class: scope === "archived" ? "primary" : "", onclick: () => setScope("archived"), text: "Archived" }),
  );
  const all = chats.filter((chat) => chat.archived === (scope === "archived"));
  const marks = journal?.marks ?? {};
  const options: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All conversations", count: all.length },
    { key: "unorganized", label: "Unorganized", count: all.filter((chat) => !chat.projectId).length },
    { key: "projects", label: "In projects", count: all.filter((chat) => chat.projectId).length },
    { key: "marked", label: "Marked", count: all.filter((chat) => marks[chat.id]).length },
  ];
  ui.filters.replaceChildren(...options.map((option) => h("button", {
    class: `filter ${filter === option.key && (option.key !== "projects" || projectFilter === null) ? "on" : ""}`,
    onclick: () => { filter = option.key; projectFilter = null; viewChanged(); },
  }, h("span", { text: option.label }), h("span", { class: "n", text: String(option.count) }))));
  ui.projects.replaceChildren(...projects.map((project) => h("button", {
    class: `filter ${projectFilter === project.id ? "on" : ""}`,
    onclick: () => { filter = "projects"; projectFilter = project.id; viewChanged(); },
  }, h("span", { text: project.name }), h("span", { class: "n", text: String(all.filter((chat) => chat.projectId === project.id).length) }))));
}

function setScope(next: "active" | "archived"): void {
  if (scope === next) return;
  scope = next;
  viewChanged();
}

// ---------- list (keyed rows, updated in place) ----------

interface RowView {
  el: HTMLElement;
  box: HTMLInputElement;
  title: HTMLElement;
  tags: HTMLElement;
  meta: HTMLElement;
  sig: string;
}

const rowViews = new Map<string, RowView>();
let shownIds: string[] = [];
const emptyList = h("div", { class: "empty" });

function rowView(id: string): RowView {
  const existing = rowViews.get(id);
  if (existing) return existing;
  const box = h("input", {
    type: "checkbox",
    tabindex: "-1",
    "aria-label": "Select",
    onclick: (event) => { event.stopPropagation(); toggleSelection(id); },
  }) as HTMLInputElement;
  const title = h("span", { class: "name" });
  const tags = h("span", { class: "tags" });
  const meta = h("div", { class: "meta" });
  const el = h("div", {
    class: "row",
    role: "option",
    "data-id": id,
    onclick: (event) => {
      if ((event as MouseEvent).shiftKey && focusId) selectRange(focusId, id);
      focusChat(id);
    },
  }, box, h("div", { class: "title" }, title, tags), meta);
  const view = { el, box, title, tags, meta, sig: "" };
  rowViews.set(id, view);
  return view;
}

function syncRow(view: RowView, chat: Chat): void {
  const mark = journal?.marks[chat.id];
  const protection = journal?.protect[chat.id];
  const focused = focusId === chat.id;
  const chosen = selected.has(chat.id);
  const sig = `${focused}|${chosen}|${chat.title}|${chat.createdMs}|${protection ? 1 : 0}|${mark ? changeLabel(mark) : ""}`;
  if (sig === view.sig) return;
  view.sig = sig;
  view.el.classList.toggle("focus", focused);
  view.el.classList.toggle("selected", chosen);
  view.el.setAttribute("aria-selected", String(chosen));
  view.box.checked = chosen;
  view.title.textContent = chat.title || "Untitled";
  const tags: HTMLElement[] = [];
  if (isUntitled(chat.title)) tags.push(h("span", { class: "badge", text: "untitled" }));
  if (protection) tags.push(h("span", { class: "badge protect", text: "Protected" }));
  else if (mark) tags.push(h("span", { class: `badge ${mark.action}`, text: changeLabel(mark) }));
  view.tags.replaceChildren(...tags);
  view.meta.textContent = chat.createdMs ? new Date(chat.createdMs).toLocaleDateString() : "—";
}

function renderList(): void {
  const rows = visibleChats();
  ui.listTitle.textContent = `Conversations · ${rows.length}`;
  const ids = rows.map((chat) => chat.id);
  const same = ids.length === shownIds.length && ids.every((id, index) => id === shownIds[index]);
  if (!same) {
    shownIds = ids;
    if (!rows.length) {
      emptyList.textContent = journal ? (search ? "No conversations match this search." : "No conversations here.") : "";
      ui.list.replaceChildren(emptyList);
    } else {
      ui.list.replaceChildren(...rows.map((chat) => rowView(chat.id).el));
    }
    const known = new Set(chats.map((chat) => chat.id));
    for (const id of rowViews.keys()) if (!known.has(id)) rowViews.delete(id);
  }
  for (const chat of rows) syncRow(rowView(chat.id), chat);
}

function revealFocus(): void {
  if (!focusId) return;
  rowViews.get(focusId)?.el.scrollIntoView({ block: "nearest" });
}

// ---------- preview (rebuilt only when the focused chat or its content changes) ----------

let previewKey = "";

function renderPreview(): void {
  const id = focusId;
  const conversation = id ? previewCache.get(id) : undefined;
  const error = id ? previewErrors.get(id) : undefined;
  const key = !id ? "none" : conversation ? `${id}:ready` : error ? `${id}:error` : `${id}:loading`;
  if (key === previewKey) return;
  previewKey = key;
  if (!id) {
    ui.preview.replaceChildren(h("div", { class: "note", text: "Select a conversation to read it before you decide." }));
    return;
  }
  if (error) {
    ui.preview.replaceChildren(h("div", { class: "err", text: `Couldn't load this conversation: ${error}` }));
    return;
  }
  if (!conversation) {
    ui.preview.replaceChildren(h("div", { class: "note", text: "Loading conversation…" }));
    return;
  }
  ui.preview.replaceChildren(
    h("h2", { text: conversation.title || "Untitled" }),
    h("div", { class: "meta", text: `${conversation.messages.length} messages` }),
    ...conversation.messages.map((message) => h("div", { class: `msg ${message.role}` },
      h("div", { class: "who", text: message.role === "user" ? "You" : "ChatGPT" }),
      h("div", { class: "body", text: message.text }),
    )),
  );
  ui.preview.scrollTop = 0;
}

function schedulePreview(id: string): void {
  if (previewCache.has(id)) return;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewTimer = null;
    if (focusId !== id) return;
    void send({ op: "conversation", accountId: signedIn(), id }).then(
      (value) => {
        previewErrors.delete(id);
        previewCache.set(id, decodeConversation(value));
        if (previewCache.size > 300) {
          const oldest = previewCache.keys().next().value;
          if (oldest != null) previewCache.delete(oldest);
        }
      },
      (error: unknown) => {
        previewErrors.set(id, failureOf(error).message);
      },
    ).then(() => {
      if (focusId === id) invalidate("preview");
    });
  }, 150);
}

// ---------- queue panel and footer ----------

function renderQueue(): void {
  const run = journal?.run;
  if (run) {
    const pending = run.jobs.slice(run.i).filter((job) => !run.results.some((result) => result.id === job.id));
    const unknown = run.inflight?.outcome === "unknown" ? run.inflight.id : null;
    ui.queue.replaceChildren(h("div", {},
      unknown
        ? h("div", { class: "err", text: `Outcome unknown for ${run.jobs.find((job) => job.id === unknown)?.title ?? unknown}. It is checked again before anything else is sent.` })
        : null,
      ...run.results.map((result) => h("div", { class: `result ${result.status}` },
        h("span", { class: "s", text: result.status }), " ", changeLabel(result), " · ", result.title || result.id,
        result.note ? h("div", { class: "note", text: result.note }) : null,
      )),
      pending.length ? h("div", { class: "note", text: `${pending.length} still to run.` }) : null,
    ));
    return;
  }
  const count = queueCount();
  ui.queue.replaceChildren(h("div", { class: "note", text: count ? `${count} marked. Press Q or Run queue to review them.` : "Mark a chat to queue a change, then run the queue." }));
}

function renderFooter(): void {
  ui.footer.textContent = activity.slice(0, 3).join(" | ") || "No activity yet.";
}

// ---------- focus, selection and marks ----------

function focusChat(id: string, reveal = false): void {
  focusId = id;
  invalidate("list", "preview");
  schedulePreview(id);
  if (reveal) queueMicrotask(revealFocus);
}

function toggleSelection(id: string): void {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  invalidate("list", "toolbar");
}

function clearSelection(): void {
  selected = new Set();
  invalidate("list", "toolbar");
}

function selectAll(): void {
  const pinnedToo = journal?.settings.pinnedInSelectAll ?? false;
  selected = new Set(visibleChats()
    .filter((chat) => !journal?.protect[chat.id] && (!chat.pinned || pinnedToo))
    .map((chat) => chat.id));
  invalidate("list", "toolbar");
}

function invertSelection(): void {
  const next = new Set<string>();
  for (const chat of visibleChats()) {
    if (!journal?.protect[chat.id] && !selected.has(chat.id)) next.add(chat.id);
  }
  selected = next;
  invalidate("list", "toolbar");
}

function selectRange(fromId: string, toId: string): void {
  const rows = visibleChats().map((chat) => chat.id);
  const from = rows.indexOf(fromId);
  const to = rows.indexOf(toId);
  if (from < 0 || to < 0) return;
  for (const id of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
    if (!journal?.protect[id]) selected.add(id);
  }
  invalidate("list", "toolbar");
}

function targets(): string[] {
  const visible = new Set(visibleChats().map((chat) => chat.id));
  if (selected.size) return [...selected].filter((id) => visible.has(id));
  return focusId ? [focusId] : [];
}

function marksChanged(): void {
  persistQuietly();
  invalidate("toolbar", "filters", "list", "queue");
}

function clearMarks(): void {
  if (!journal || !canEdit()) return;
  for (const id of targets()) delete journal.marks[id];
  marksChanged();
}

function canEdit(): boolean {
  if (!journal) {
    toast("Changes are switched off until the organizer journal loads.");
    return false;
  }
  if (isRunActive(journal.run)) {
    toast("Marks can't change while a run is in progress.");
    return false;
  }
  return true;
}

function markTimes(journal: Journal): (id: string) => number {
  const reviewed = new Map(journal.run?.jobs.map((job) => [job.id, job.markAt]));
  const now = Date.now();
  return (id) => Math.max(now, (journal.marks[id]?.at ?? 0) + 1, (reviewed.get(id) ?? 0) + 1);
}

// Applies one action to every target as a single state change and a single write.
function setMarks(ids: readonly string[], action: Action, options: { newTitle?: string; project?: string; projectName?: string } = {}): void {
  if (!journal || !canEdit()) return;
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  if (action === "protect") {
    const protectAll = ids.some((id) => !journal?.protect[id]);
    for (const id of ids) {
      if (protectAll) {
        journal.protect[id] = { title: byId.get(id)?.title ?? id, at: Date.now() };
        delete journal.marks[id];
      } else {
        delete journal.protect[id];
      }
    }
    marksChanged();
    return;
  }
  const refused = new Map<string, number>();
  const markTime = markTimes(journal);
  let marked = 0;
  for (const id of ids) {
    const chat = byId.get(id);
    const reason = chat ? whyNot(chat, action, compatOk, journal.protect) : "That chat isn't loaded.";
    if (!chat || reason) {
      refused.set(reason ?? "", (refused.get(reason ?? "") ?? 0) + 1);
      continue;
    }
    journal.marks[id] = {
      action,
      title: chat.title,
      newTitle: action === "rename" ? options.newTitle ?? null : null,
      project: action === "move" ? options.project ?? "" : "",
      projectName: action === "move" ? options.projectName ?? "" : "",
      at: markTime(id),
    };
    marked += 1;
  }
  for (const [reason, count] of refused) toast(count > 1 ? `${count} chats skipped: ${reason}` : reason);
  if (marked) marksChanged();
}

function markSelection(action: Action): void {
  const ids = targets();
  if (!ids.length) {
    toast("Select or focus a conversation first.");
    return;
  }
  if (!canEdit()) return;
  if (action === "rename") {
    const current = chats.find((chat) => chat.id === ids[0])?.title ?? "";
    openPrompt(`Rename ${ids.length === 1 ? "conversation" : `${ids.length} conversations`}`, current, (value) => {
      if (!value.trim()) return;
      setMarks(ids, "rename", { newTitle: value.trim() });
      if (!selected.size) moveFocus(1);
    });
    return;
  }
  if (action === "move") {
    openMove(ids);
    return;
  }
  setMarks(ids, action);
  if (!selected.size && action !== "protect") moveFocus(1);
}

function moveFocus(delta: number, extend = false): void {
  const rows = visibleChats().map((chat) => chat.id);
  if (!rows.length) return;
  const current = focusId ? rows.indexOf(focusId) : -1;
  const next = rows[Math.min(rows.length - 1, Math.max(0, current + delta))];
  if (next == null) return;
  if (extend && focusId) selectRange(focusId, next);
  focusChat(next, true);
}

// ---------- dialogs ----------

interface ModalButton {
  label: string;
  primary?: boolean;
  // Returns false to keep the dialog open.
  run?: () => boolean | void;
}

function openModal(titleText: string, body: HTMLElement, buttons: ModalButton[]): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const elements = buttons.map((button) => h("button", { class: button.primary ? "primary" : "", text: button.label }));
  const veil = h("div", { class: "veil" },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": titleText },
      h("h2", { text: titleText }),
      body,
      h("div", { class: "buttons" }, ...elements),
    ),
  );
  const close = (): void => {
    veil.remove();
    document.removeEventListener("keydown", onKey, true);
    opener?.focus();
  };
  const activate = (button: ModalButton): void => {
    if (button.run?.() === false) return;
    close();
  };
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      const primary = buttons.find((button) => button.primary);
      if (!primary) return;
      event.preventDefault();
      event.stopPropagation();
      activate(primary);
    }
  }
  elements.forEach((element, index) => {
    const button = buttons[index];
    if (button) element.addEventListener("click", () => activate(button));
  });
  veil.addEventListener("click", (event) => {
    if (event.target === veil) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(veil);
  const first = body.querySelector<HTMLElement>("input:not([type=checkbox]), select") ?? elements.find((_, index) => buttons[index]?.primary) ?? null;
  first?.focus();
  if (first instanceof HTMLInputElement) first.select();
  return close;
}

function openPrompt(titleText: string, initial: string, onConfirm: (value: string) => void): void {
  const input = h("input", { type: "text", value: initial, "aria-label": "New title" }) as HTMLInputElement;
  openModal(titleText, h("div", { class: "field" }, h("label", { text: "New title" }), input), [
    { label: "Cancel" },
    { label: "Queue rename", primary: true, run: () => onConfirm(input.value) },
  ]);
}

function openMove(ids: string[]): void {
  const select = h("select", { "aria-label": "Project" },
    h("option", { value: "", text: "No Project" }),
    ...projects.map((project) => h("option", { value: project.id, text: project.name })),
  ) as HTMLSelectElement;
  openModal("Move to project", h("div", { class: "field" },
    h("label", { text: `Move ${ids.length} ${ids.length === 1 ? "chat" : "chats"} to` }),
    select,
  ), [
    { label: "Cancel" },
    {
      label: "Queue move",
      primary: true,
      run: () => {
        const id = select.value;
        setMarks(ids, "move", { project: id, projectName: projects.find((project) => project.id === id)?.name ?? "" });
      },
    },
  ]);
}

function changeCell(job: Job): string {
  switch (job.action) {
    case "delete": return "Deleted permanently";
    case "archive": return "Moved to Archived";
    case "unarchive": return "Back to active chats";
    case "rename": return `Renamed to “${job.newTitle ?? ""}”`;
    case "move": return `Moved to ${job.projectName || "No Project"}`;
  }
}

function openReview(): void {
  if (!journal || !runner || isRunActive(journal.run) || journal.run?.status === "paused") return;
  const { jobs, skipped } = buildJobs(journal, chats);
  if (!jobs.length) {
    toast(skipped.length ? `None of the ${skipped.length} marks can run: ${skipped[0]?.reason ?? ""}` : "Nothing is queued.");
    return;
  }
  const deletes = jobs.filter((job) => job.action === "delete").length;
  const typed = requiresTypedConfirmation(deletes, CONFIG.typeToConfirm);
  const confirmInput = h("input", { type: "text", placeholder: String(deletes), "aria-label": "Confirmation count" }) as HTMLInputElement;
  const backupToggle = h("input", { type: "checkbox", checked: journal.settings.backup }) as HTMLInputElement;
  const incompleteToggle = h("input", { type: "checkbox" }) as HTMLInputElement;
  const gapInput = h("input", {
    type: "number",
    min: String(CONFIG.gapMin),
    max: String(CONFIG.gapMax),
    value: String(clampGap(journal.settings.gap, CONFIG)),
    "aria-label": "Seconds between changes",
  }) as HTMLInputElement;
  const table = h("table", { class: "review" },
    h("thead", {}, h("tr", {}, h("th", { text: "#" }), h("th", { text: "Conversation" }), h("th", { text: "Change" }))),
    h("tbody", {}, ...jobs.map((job, index) => h("tr", { class: job.action },
      h("td", { class: "n", text: String(index + 1) }),
      h("td", { text: job.title || "Untitled" }),
      h("td", { text: changeCell(job) }),
    ))),
  );
  const body = h("div", {},
    h("p", { text: `These ${jobs.length} ${jobs.length === 1 ? "change runs" : "changes run"} one at a time, in this order. Only this exact list is authorized.` }),
    deletes ? h("p", { class: "err", text: `${deletes} ${deletes === 1 ? "chat is" : "chats are"} deleted permanently.` }) : null,
    h("div", { class: "review-wrap" }, table),
    skipped.length ? h("div", { class: "note" },
      h("p", { text: `${skipped.length} ${skipped.length === 1 ? "mark doesn't" : "marks don't"} run:` }),
      h("ul", {}, ...skipped.slice(0, 20).map((entry) => h("li", { text: `${entry.title || entry.id}: ${entry.reason}` }))),
    ) : null,
    deletes ? h("div", { class: "field" },
      h("label", {}, backupToggle, " Back up every chat before deleting it"),
      h("label", {}, incompleteToggle, " Also delete chats whose attachments, media or unfamiliar content the backup may not recover"),
      h("p", { class: "note", text: `The backup is a JSON file with each chat's full record. ${BACKUP_EXCLUDES} Without the second box, such chats are kept.` }),
    ) : null,
    h("div", { class: "field" }, h("label", { text: "Seconds between changes" }), gapInput),
    typed ? h("div", { class: "field" }, h("label", { text: `Type ${deletes} to confirm deletion` }), confirmInput) : null,
  );
  openModal("Review and run", body, [
    { label: "Cancel" },
    {
      label: `Run ${jobs.length} ${jobs.length === 1 ? "change" : "changes"}`,
      primary: true,
      run: () => {
        if (typed && confirmInput.value.trim() !== String(deletes)) {
          confirmInput.focus();
          return false;
        }
        void startRun(jobs, {
          backup: deletes > 0 && backupToggle.checked,
          acceptIncomplete: incompleteToggle.checked,
          gap: Number(gapInput.value) || CONFIG.gapDefault,
        });
        return true;
      },
    },
  ]);
}

// ---------- backup saving ----------

interface SaveHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}

type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

function savePicker(): SavePicker | null {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

// The file is written through a handle and read back, so the hash proves its bytes are on disk.
async function saveBackup(): Promise<void> {
  const pending = runner?.pendingBackup();
  const run = journal?.run;
  if (!pending || !run || !runner) return;
  const name = `chatgpt-organizer-backup-${fileStamp(run.startedAt)}-${run.id}.json`;
  const picker = savePicker();
  if (!picker) {
    confirmDownloadedBackup(name, pending.text, pending.sha256);
    return;
  }
  let handle: SaveHandle;
  try {
    handle = await picker({ suggestedName: name, types: [{ description: "Backup", accept: { "application/json": [".json"] } }] });
  } catch (error) {
    toast(error instanceof DOMException && error.name === "AbortError"
      ? "The backup wasn't saved, so nothing has been deleted."
      : `Couldn't save the backup: ${failureOf(error).message}. Nothing has been deleted.`);
    return;
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(pending.text);
    await writable.close();
    const written = await sha256Hex(await (await handle.getFile()).arrayBuffer());
    if (written !== pending.sha256) throw new TriageError("http", "The saved file doesn't match the backup");
  } catch (error) {
    toast(`Couldn't verify the saved backup: ${failureOf(error).message}. Nothing has been deleted.`);
    return;
  }
  await acknowledge({ file: handle.name, sha256: pending.sha256, verification: "file" });
}

async function acknowledge(proof: BackupProof): Promise<void> {
  if (await runner?.acknowledgeBackupSaved(proof)) return;
  toast(`${proof.file} was saved, but the run changed while it was saving, so nothing was deleted. Resume to continue; it may ask for the backup again.`);
}

function confirmDownloadedBackup(name: string, text: string, sha256: string): void {
  download(name, text, "application/json");
  const check = h("input", { type: "checkbox" }) as HTMLInputElement;
  openModal("Confirm the backup file", h("div", {},
    h("p", { text: `Chrome can't confirm that ${name} was written. Open your downloads folder and check that it is there before continuing.` }),
    h("p", { class: "note", text: `SHA-256: ${sha256}` }),
    h("label", {}, check, " I can see the complete backup file"),
  ), [
    { label: "Not yet" },
    {
      label: "Continue",
      primary: true,
      run: () => {
        if (!check.checked) return false;
        void acknowledge({ file: name, sha256, verification: "confirmed" });
        return true;
      },
    },
  ]);
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

// ---------- plans and reports ----------

const PlanMarkSchema = Schema.Struct({
  action: Schema.Literals(["delete", "archive", "unarchive", "rename", "move"]),
  title: Schema.String,
  newTitle: Schema.Union([Schema.String, Schema.Null]),
  project: Schema.String,
  projectName: Schema.String,
  at: Schema.Number,
});

const PlanSchema = Schema.Struct({
  version: Schema.Number,
  accountId: Schema.String,
  marks: Schema.Record(Schema.String, PlanMarkSchema),
  protect: Schema.Record(Schema.String, Schema.Struct({ title: Schema.String, at: Schema.Number })),
});

function importPlan(): void {
  if (!journal || !canEdit()) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file || !journal) return;
    void file.text().then((text) => {
      if (!journal || !canEdit()) return;
      let check;
      try {
        const plan = decodeValue(PlanSchema, JSON.parse(text) as unknown);
        check = validatePlan(
          { ...plan, marks: { ...plan.marks }, protect: { ...plan.protect } },
          { accountId: journal.accountId, chats, projects, protect: journal.protect },
        );
      } catch (error) {
        toast(`Couldn't read that plan: ${failureOf(error).message}`);
        return;
      }
      if (!check.ok) {
        openModal("Plan rejected", h("div", {},
          h("p", { text: `Nothing was imported. ${check.problems.length} ${check.problems.length === 1 ? "entry doesn't" : "entries don't"} match this account's chats:` }),
          h("ul", {}, ...check.problems.slice(0, 30).map((problem) => h("li", { text: problem }))),
        ), [{ label: "Close", primary: true }]);
        return;
      }
      const markTime = markTimes(journal);
      for (const [id, mark] of Object.entries(check.marks)) {
        journal.marks[id] = { ...mark, at: markTime(id) };
      }
      journal.protect = { ...journal.protect, ...check.protect };
      marksChanged();
      toast(`Imported ${Object.keys(check.marks).length} planned changes.`);
    });
  });
  input.click();
}

function exportPlan(): void {
  if (!journal) return;
  const marks: Record<string, Mark> = {};
  for (const [id, mark] of Object.entries(journal.marks)) if (mark.action !== "protect") marks[id] = mark;
  const plan = { version: 2, accountId: journal.accountId, marks, protect: journal.protect };
  download(`chatgpt-organizer-plan-${fileStamp(Date.now())}.json`, JSON.stringify(plan, null, 2), "application/json");
}

function exportReport(): void {
  const run = journal?.run;
  if (!run) return;
  const report = { runId: run.id, accountId: run.accountId, status: run.status, backup: run.backup, results: run.results };
  download(`chatgpt-organizer-report-${fileStamp(Date.now())}.json`, JSON.stringify(report, null, 2), "application/json");
}

// ---------- keyboard ----------

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const KEY_ACTIONS: Record<string, Action | "clear"> = {
  d: "delete", a: "archive", u: "unarchive", r: "rename", m: "move", p: "protect", c: "clear",
};

function onKey(event: KeyboardEvent): void {
  if (document.querySelector(".veil") || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "Escape" && event.target === ui.search) {
    ui.search.blur();
    return;
  }
  if (event.key === "/" && !isTyping(event.target)) {
    event.preventDefault();
    ui.search.focus();
    return;
  }
  if (isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  if (event.key === "ArrowDown" || key === "j") {
    event.preventDefault();
    moveFocus(1, event.shiftKey);
  } else if (event.key === "ArrowUp" || key === "k") {
    event.preventDefault();
    moveFocus(-1, event.shiftKey);
  } else if (event.key === " " || key === "x") {
    event.preventDefault();
    if (focusId) toggleSelection(focusId);
  } else if (event.key === "Escape") {
    clearSelection();
  } else if (key === "q") {
    event.preventDefault();
    const controls = runControls(journal?.run ?? null);
    if (controls === "working") void runner?.pause("Paused by you.");
    else if (controls === "idle" || controls === "finished") openReview();
  } else if (key in KEY_ACTIONS) {
    event.preventDefault();
    const action = KEY_ACTIONS[key];
    if (action === "clear") clearMarks();
    else if (action) markSelection(action);
  }
}

// ---------- boot ----------

let booting = true;

chrome.runtime.onMessage.addListener((message) => {
  const update = decodeListProgress(message);
  if (!update || !booting) return false;
  progress = update.waiting
    ? "Waiting for ChatGPT…"
    : `Loading ${update.found}${update.total !== null ? ` of ${update.total}` : ""} ${update.scope} chats…`;
  invalidate("toolbar");
  return false;
});

async function boot(): Promise<void> {
  try {
    progress = "Connecting to ChatGPT…";
    invalidate("toolbar");
    const session = decodeValue(SessionSchema, await send({ op: "session" }));
    accountId = session.accountId;
    const loaded = await store.load(session.accountId);
    loaded.settings.gap = clampGap(Number(loaded.settings.gap) || CONFIG.gapDefault, CONFIG);
    recoverInterrupted(loaded);
    journal = loaded;
    await persistJournal();
    const active = await loadChats("active");
    const archived = await loadChats("archived").catch((error: unknown) => {
      toast(`Couldn't load the archived list: ${failureOf(error).message}`);
      return { chats: [], complete: false, total: null };
    });
    chats.splice(0, chats.length, ...active.chats, ...archived.chats.filter((chat) => !active.chats.some((other) => other.id === chat.id)));
    if (!active.complete || !archived.complete) {
      inventoryNote = `ChatGPT returned ${chats.length} chats${active.total != null ? ` of ${active.total} active` : ""}; only loaded chats can be changed.`;
    }
    projects = await send({ op: "projects", accountId: signedIn() }).then(
      (value) => decodeValue(ProjectListSchema, value).map((project) => ({ ...project })),
      () => {
        toast("Couldn't load projects; moving chats is unavailable this session.");
        return [];
      },
    );
    compatOk = true;
    runner = makeRunner(loaded);
    focusId = visibleChats()[0]?.id ?? null;
    if (focusId) schedulePreview(focusId);
  } catch (error) {
    const failure = failureOf(error);
    compatOk = false;
    blocked = failure.message;
    toast(failure.message);
  } finally {
    booting = false;
    progress = "";
    invalidateAll();
  }
}

function showWaiting(): void {
  app.replaceChildren(h("div", { class: "waiting" },
    h("h1", { text: "ChatGPT Organizer is open in another tab" }),
    h("p", { text: "Only one dashboard can manage your chats at a time. This tab takes over as soon as the other one closes." }),
  ));
}

async function main(): Promise<void> {
  const start = async (): Promise<void> => {
    journal = null;
    buildLayout();
    document.addEventListener("keydown", onKey);
    invalidateAll();
    await boot();
  };
  // The lock is held for the life of this tab, so at most one dashboard can run changes.
  await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      showWaiting();
      void navigator.locks.request(LOCK_NAME, async () => {
        await start();
        await new Promise<never>(() => undefined);
      });
      return;
    }
    await start();
    await new Promise<never>(() => undefined);
  });
}

void main();
