import { TriageError } from "./errors.ts";
import {
  buildJobs,
  clamp,
  toMarkdown,
  type Chat,
  type Conversation,
  type ConversationProbe,
  type Job,
  type Journal,
  type Result,
  type Run,
} from "./model.ts";
import { CONFIG, scaled, type Config } from "./api.ts";

export interface QueueTransport {
  getConversation(id: string): Promise<Conversation>;
  writeChange(job: Job): Promise<void>;
  listActive(): Promise<Chat[]>;
  probe(id: string): Promise<ConversationProbe>;
}

export interface BackedUpConversation {
  id: string;
  title: string;
  createdMs: number;
  messages: Conversation["messages"];
}

export interface QueueEvent {
  type: "note" | "change";
  message?: string;
}

export interface QueueDeps {
  transport: QueueTransport;
  journal: Journal;
  chats: Chat[];
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  persist: () => void | Promise<void>;
  config?: Config;
  scale?: number;
  owner: string;
  onEvent?: (event: QueueEvent) => void;
}

const ACTIVE = new Set(["backup", "saving", "running", "waiting", "verifying"]);

function markFor(job: Job, nowMs: number): Journal["marks"][string] {
  if (job.action === "move") {
    return { action: "move", title: job.title, newTitle: null, project: job.project, projectName: job.projectName, at: nowMs };
  }
  if (job.action === "rename") {
    return { action: "rename", title: job.title, newTitle: job.newTitle, project: "", projectName: "", at: nowMs };
  }
  return { action: job.action, title: job.title, newTitle: null, project: "", projectName: "", at: nowMs };
}

export class QueueRunner {
  private readonly deps: QueueDeps;
  private readonly config: Config;
  private readonly scale: number;
  private wake: AbortController | null = null;
  private looping = false;
  private resumeAfter = false;
  private backup: BackedUpConversation[] = [];
  private backupRun: string | null = null;

  constructor(deps: QueueDeps) {
    this.deps = deps;
    this.config = deps.config ?? CONFIG;
    this.scale = deps.scale ?? 1;
  }

  get run(): Run | null {
    return this.deps.journal.run;
  }

  isActive(): boolean {
    const run = this.run;
    return Boolean(run && ACTIVE.has(run.status));
  }

  async waitUntilIdle(): Promise<void> {
    while (this.looping) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  backupText(): string {
    return toMarkdown(this.backup);
  }

  private emit(event: QueueEvent): void {
    this.deps.onEvent?.(event);
  }

  private note(message: string): void {
    this.emit({ type: "note", message });
  }

  private buildJobs(): Job[] {
    return buildJobs(this.deps.journal, this.deps.chats);
  }

  start(options: { backup: boolean; runId?: string }): void {
    const jobs = this.buildJobs();
    if (!jobs.length) return;
    const wantBackup = options.backup && jobs.some((job) => job.action === "delete");
    const nowMs = this.deps.now();
    this.deps.journal.run = {
      id: options.runId ?? nowMs.toString(36),
      status: wantBackup ? "backup" : "running",
      phase: wantBackup ? "backup" : "write",
      jobs,
      i: 0,
      results: [],
      startedAt: nowMs,
      owner: this.deps.owner,
      beat: nowMs,
      lastWriteAt: 0,
      nextAt: 0,
      fails: 0,
      note: "",
      current: null,
      held: {},
      backupCount: 0,
      backupFile: null,
      backupDownloaded: null,
      finishedAt: null,
    };
    this.backup = [];
    this.backupRun = null;
    void this.deps.persist();
    this.note(`Started: ${jobs.length} ${jobs.length === 1 ? "change" : "changes"}.`);
    void this.loop();
  }

  resume(): void {
    const run = this.run;
    if (!run || run.status !== "paused") return;
    if (this.looping) {
      this.resumeAfter = true;
      return;
    }
    run.owner = this.deps.owner;
    run.status = run.phase === "backup" ? "backup" : "running";
    run.note = "";
    run.fails = 0;
    void this.deps.persist();
    this.note("Resumed.");
    void this.loop();
  }

  pause(reason: string): void {
    const run = this.run;
    if (!run || !ACTIVE.has(run.status)) return;
    run.status = "paused";
    run.note = reason;
    run.nextAt = 0;
    void this.deps.persist();
    this.wake?.abort();
    this.note(reason ? `Paused: ${reason}` : "Paused.");
    this.emit({ type: "change" });
  }

  stop(): void {
    const run = this.run;
    if (!run) return;
    this.resumeAfter = false;
    run.status = "stopped";
    run.note = "";
    run.nextAt = 0;
    run.finishedAt = this.deps.now();
    void this.deps.persist();
    this.wake?.abort();
    this.note("Stopped. Chats that weren't reached keep their marks.");
    this.emit({ type: "change" });
  }

  dismiss(): void {
    this.deps.journal.run = null;
    void this.deps.persist();
    this.emit({ type: "change" });
  }

  acknowledgeBackupSaved(filename: string): void {
    const run = this.run;
    if (!run || run.status !== "saving" || this.backupRun !== run.id || !this.backup.length) return;
    run.backupFile = filename;
    this.note(`Saved the backup of ${this.backup.length} ${this.backup.length === 1 ? "chat" : "chats"} as ${filename}.`);
    run.phase = "write";
    run.status = "running";
    run.owner = this.deps.owner;
    void this.deps.persist();
    void this.loop();
  }

  private record(run: Run, job: Job, status: Result["status"], detail = ""): void {
    run.results.push({
      id: job.id,
      action: job.action,
      title: job.title,
      newTitle: job.newTitle,
      project: job.project,
      projectName: job.projectName,
      status,
      note: detail,
      at: this.deps.now(),
    });
  }

  private satisfied(job: Job, probe: ConversationProbe): boolean {
    switch (job.action) {
      case "delete": return !probe.visible;
      case "archive": return probe.archived;
      case "unarchive": return !probe.archived;
      case "rename": return probe.title === job.newTitle;
      case "move": return (probe.projectId ?? "") === job.project;
    }
  }

  // Before repeating an in-flight destructive change after an interruption, ask ChatGPT
  // whether it already took effect. If it did, reconcile instead of sending it again.
  private async reconcileInFlight(run: Run, signal: AbortSignal): Promise<void> {
    const job = run.jobs[run.i];
    if (!job || run.current !== job.id) return;
    let probe: ConversationProbe;
    try {
      probe = await this.deps.transport.probe(job.id);
    } catch (error) {
      if (error instanceof TriageError && error.kind === "aborted") throw error;
      if (error instanceof TriageError && error.kind === "notfound" && job.action === "delete") {
        probe = { archived: false, visible: false, projectId: null, title: null };
      } else {
        throw new TriageError("http", "Couldn't check an interrupted change. Verify it in ChatGPT, then resume.");
      }
    }
    if (signal.aborted) throw new TriageError("aborted", "Stopped.");
    if (!this.satisfied(job, probe)) return;
    delete this.deps.journal.marks[job.id];
    this.record(run, job, "done", "Reconciled after an interruption; it was not sent again.");
    run.i += 1;
    run.current = null;
    this.applyLocally(job);
    void this.deps.persist();
  }

  private applyLocally(job: Job): void {
    delete this.deps.journal.marks[job.id];
    const chats = this.deps.chats;
    const index = chats.findIndex((chat) => chat.id === job.id);
    const chat = index >= 0 ? chats[index] : undefined;
    if (!chat) return;
    if (job.action === "delete" || job.action === "archive") {
      chats.splice(index, 1);
    } else if (job.action === "unarchive") {
      chats.splice(index, 1);
    } else if (job.action === "rename") {
      chat.title = job.newTitle ?? chat.title;
    } else if (job.action === "move") {
      chat.projectId = job.project || null;
      chat.updatedMs = this.deps.now();
    }
  }

  private async waitForCooldown(signal: AbortSignal): Promise<void> {
    const left = () => Math.max(0, this.deps.journal.cooldownUntil - this.deps.now());
    while (left() > 0) {
      await this.deps.sleep(Math.min(1000, left()), signal);
    }
  }

  private async loop(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    const wake = new AbortController();
    this.wake = wake;
    const run = this.run;
    if (!run) {
      this.looping = false;
      this.wake = null;
      return;
    }
    const set = (status: Run["status"]) => {
      if (!wake.signal.aborted) run.status = status;
    };
    try {
      if (run.current) {
        await this.reconcileInFlight(run, wake.signal);
      }
      if (run.phase === "backup") {
        await this.doBackup(run, wake.signal);
        if (this.backup.length) {
          run.phase = "save";
          set("saving");
          void this.deps.persist();
          return;
        }
        run.phase = "write";
        set("running");
        void this.deps.persist();
      }
      while (run.i < run.jobs.length) {
        if (wake.signal.aborted) return;
        const job = run.jobs[run.i];
        if (!job) break;
        run.current = job.id;

        const held = run.held[job.id];
        if (held && job.action === "delete") {
          this.record(run, job, "held", `Not deleted: it couldn't be backed up. ${held} It's still marked.`);
          run.i += 1;
          void this.deps.persist();
          this.emit({ type: "change" });
          continue;
        }

        while (this.deps.journal.cooldownUntil > this.deps.now()) {
          set("waiting");
          run.nextAt = 0;
          this.emit({ type: "change" });
          await this.waitForCooldown(wake.signal);
        }

        const gap = run.lastWriteAt + scaled(this.deps.journal.settings.gap * 1000, this.scale) - this.deps.now();
        if (gap > 0) {
          set("running");
          run.nextAt = this.deps.now() + gap;
          this.emit({ type: "change" });
          await this.deps.sleep(gap, wake.signal);
        }
        set("running");
        run.nextAt = 0;
        run.current = job.id;
        this.emit({ type: "change" });
        try {
          await this.deps.transport.writeChange(job);
          run.lastWriteAt = this.deps.now();
          this.applyLocally(job);
          this.record(run, job, "done");
          run.i += 1;
          run.fails = 0;
          job.tries = 0;
          run.current = null;
          // Cooldown/strikes are owned by the API client; the transport signals them by throwing.
        } catch (error) {
          run.lastWriteAt = this.deps.now();
          const failure = error instanceof TriageError ? error : null;
          const kind = failure?.kind ?? "http";
          if (kind === "ratelimit" || kind === "cooldown") {
            if (failure && failure.until > 0) {
              this.deps.journal.cooldownUntil = Math.max(this.deps.journal.cooldownUntil, failure.until);
              void this.deps.persist();
            }
            continue;
          }
          if (kind === "notfound") {
            if (job.action === "delete" || job.action === "archive") {
              this.applyLocally(job);
              this.record(run, job, "done", "It was already gone.");
            } else {
              this.record(run, job, "failed", "Chat not found.");
            }
            run.i += 1;
            run.current = null;
            continue;
          }
          if (kind === "auth") {
            this.pause(failure?.message ?? "Sign-in expired.");
            return;
          }
          job.tries += 1;
          if (kind === "transient" && job.tries <= this.config.transientBackoff.length) {
            run.note = `${failure?.message ?? "Server error."} Trying again shortly.`;
            this.emit({ type: "change" });
            await this.deps.sleep(scaled(this.config.transientBackoff[job.tries - 1] ?? 0, this.scale), wake.signal);
            run.note = "";
            continue;
          }
          this.record(run, job, "failed", failure?.message ?? "Change failed.");
          run.i += 1;
          run.current = null;
          run.fails += 1;
          if (run.fails >= 3) {
            this.pause("Three changes in a row failed. Check ChatGPT, then resume.");
            return;
          }
        } finally {
          void this.deps.persist();
          this.emit({ type: "change" });
        }
      }
      if (wake.signal.aborted) return;
      set("verifying");
      run.current = null;
      this.emit({ type: "change" });
      await this.verify(run);
      run.status = "done";
      run.finishedAt = this.deps.now();
      void this.deps.persist();
      const failed = run.results.filter((result) => result.status !== "done").length;
      this.note(`Finished. ${run.results.length - failed} ${run.results.length - failed === 1 ? "change" : "changes"} made${failed ? `, ${failed} need attention` : ""}.`);
    } catch (error) {
      const failure = error instanceof TriageError ? error : null;
      if (failure?.kind !== "aborted") this.pause(failure?.message ?? String(error));
    } finally {
      this.looping = false;
      if (this.wake === wake) this.wake = null;
      void this.deps.persist();
      this.emit({ type: "change" });
      if (this.resumeAfter) {
        this.resumeAfter = false;
        queueMicrotask(() => this.resume());
      }
    }
  }

  private async doBackup(run: Run, signal: AbortSignal): Promise<void> {
    const targets = run.jobs.filter((job) => job.action === "delete");
    const out: BackedUpConversation[] = [];
    const held: Record<string, string> = {};
    let tries = 0;
    for (let index = 0; index < targets.length; index += 1) {
      if (signal.aborted) throw new TriageError("aborted", "Stopped.");
      const job = targets[index];
      if (!job) continue;
      run.status = "backup";
      run.current = job.id;
      run.note = `Backing up chat ${index + 1} of ${targets.length} before deleting anything.`;
      this.emit({ type: "change" });
      try {
        const conversation = await this.deps.transport.getConversation(job.id);
        const createdMs = this.deps.chats.find((chat) => chat.id === job.id)?.createdMs ?? 0;
        out.push({ id: job.id, title: job.title, createdMs, messages: conversation.messages });
        tries = 0;
        if (index < targets.length - 1) await this.deps.sleep(scaled(this.config.backupGap, this.scale), signal);
      } catch (error) {
        const failure = error instanceof TriageError ? error : null;
        if (failure?.kind === "aborted") throw error;
        if (failure && (failure.kind === "ratelimit" || failure.kind === "cooldown")) {
          if (failure.until > 0) this.deps.journal.cooldownUntil = Math.max(this.deps.journal.cooldownUntil, failure.until);
          run.status = "waiting";
          this.emit({ type: "change" });
          await this.waitForCooldown(signal);
          index -= 1;
          continue;
        }
        if (failure?.kind === "transient" && tries < this.config.transientBackoff.length) {
          await this.deps.sleep(scaled(this.config.transientBackoff[tries] ?? 0, this.scale), signal);
          tries += 1;
          index -= 1;
          continue;
        }
        if (failure?.kind === "auth") throw error;
        tries = 0;
        if (failure?.kind === "notfound") continue;
        held[job.id] = failure?.message ?? "unknown error";
      }
    }
    this.backup = out;
    this.backupRun = run.id;
    run.held = held;
    run.note = "";
    run.backupCount = out.length;
    const kept = Object.keys(held).length;
    if (kept) this.note(`Couldn't back up ${kept} ${kept === 1 ? "chat" : "chats"}, so ${kept === 1 ? "it won't" : "they won't"} be deleted.`);
  }

  private async verify(run: Run): Promise<void> {
    const gone = run.results.filter((result) => result.status === "done" && (result.action === "delete" || result.action === "archive"));
    const moved = run.results.filter((result) => result.status === "done" && result.action === "move");
    if (!gone.length && !moved.length) return;
    run.note = "Double-checking with ChatGPT.";
    this.emit({ type: "change" });
    let fresh: Chat[];
    try {
      fresh = await this.deps.transport.listActive();
    } catch (error) {
      run.note = `Couldn't double-check: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const listed = new Map(fresh.map((chat) => [chat.id, chat]));
    const suspects = [
      ...gone.filter((result) => listed.has(result.id)),
      ...moved.filter((result) => listed.has(result.id) && (listed.get(result.id)?.projectId ?? "") !== result.project),
    ];
    const stuck = new Set<string>();
    for (const result of suspects) {
      const probe = await this.probeChange(result);
      if (probe) {
        stuck.add(result.id);
        continue;
      }
      result.status = "unconfirmed";
      result.note = "ChatGPT still shows this chat unchanged. It's marked again so you can retry.";
      this.deps.journal.marks[result.id] = markFor(
        {
          id: result.id,
          action: result.action,
          newTitle: result.newTitle,
          title: result.title,
          project: result.project,
          projectName: result.projectName,
          tries: 0,
        },
        this.deps.now(),
      );
    }
    const movedTo = new Map(moved.map((result) => [result.id, result.project || null]));
    this.deps.chats.splice(0, this.deps.chats.length, ...fresh.filter((chat) => !(stuck.has(chat.id) && !movedTo.has(chat.id))));
    for (const chat of this.deps.chats) {
      if (stuck.has(chat.id) && movedTo.has(chat.id)) chat.projectId = movedTo.get(chat.id) ?? null;
    }
    run.note = "";
    void this.deps.persist();
  }

  // Returns true only when the change really stuck. GPT's list can lag, so a listed chat is probed directly.
  private async probeChange(result: Result): Promise<boolean> {
    const job: Job = {
      id: result.id,
      action: result.action,
      newTitle: result.newTitle,
      title: result.title,
      project: result.project,
      projectName: result.projectName,
      tries: 0,
    };
    try {
      const probe = await this.deps.transport.probe(result.id);
      return this.satisfied(job, probe);
    } catch (error) {
      return error instanceof TriageError && error.kind === "notfound" && result.action === "delete";
    }
  }
}

export function clampGap(value: number, config: Config = CONFIG): number {
  return clamp(value, config.gapMin, config.gapMax);
}
