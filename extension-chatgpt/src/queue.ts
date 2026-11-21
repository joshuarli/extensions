import { failureOf, mayHaveApplied, TriageError } from "./errors.ts";
import {
  applyToInventory,
  buildBackup,
  clamp,
  describeConversation,
  isIncomplete,
  isRunActive,
  jobOf,
  listedSatisfies,
  satisfies,
  type BackupEntry,
  type BuiltBackup,
  type Chat,
  type ConversationProbe,
  type Job,
  type Journal,
  type Mark,
  type Result,
  type Run,
  type RunStatus,
  type SavedBackup,
} from "./model.ts";
import { CONFIG, scaled, type Config } from "./api.ts";

export interface QueueTransport {
  fetchRecord(id: string): Promise<unknown>;
  writeChange(run: Run, job: Job): Promise<void>;
  listActive(): Promise<{ chats: Chat[]; complete: boolean }>;
  probe(id: string): Promise<ConversationProbe>;
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
  persist: () => Promise<void>;
  config?: Config;
  scale?: number;
  onEvent?: (event: QueueEvent) => void;
}

export interface StartOptions {
  runId: string;
  backup: boolean;
  acceptIncomplete: boolean;
}

export interface PendingBackup extends BuiltBackup {
  runId: string;
}

export interface BackupProof {
  file: string;
  sha256: string;
  verification: SavedBackup["verification"];
}

type Settled = "applied" | "not-applied" | "gone" | "unknown";

function markFor(job: Job, nowMs: number): Mark {
  return {
    action: job.action,
    title: job.title,
    newTitle: job.action === "rename" ? job.newTitle : null,
    project: job.action === "move" ? job.project : "",
    projectName: job.action === "move" ? job.projectName : "",
    at: nowMs,
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const aborted = (): TriageError => new TriageError("aborted", "Stopped.");

export class QueueRunner {
  private readonly deps: QueueDeps;
  private readonly config: Config;
  private readonly scale: number;
  private wake: AbortController | null = null;
  private looping: Promise<void> | null = null;
  private resumeAfter = false;
  private kickAfter = false;
  private pending: PendingBackup | null = null;

  constructor(deps: QueueDeps) {
    this.deps = deps;
    this.config = deps.config ?? CONFIG;
    this.scale = deps.scale ?? 1;
  }

  get run(): Run | null {
    return this.deps.journal.run;
  }

  isActive(): boolean {
    return isRunActive(this.run);
  }

  async waitUntilIdle(): Promise<void> {
    while (this.looping) await this.looping;
  }

  pendingBackup(): PendingBackup | null {
    return this.pending && this.pending.runId === this.run?.id ? this.pending : null;
  }

  private emit(event: QueueEvent): void {
    this.deps.onEvent?.(event);
  }

  private changed(): void {
    this.emit({ type: "change" });
  }

  private note(message: string): void {
    this.emit({ type: "note", message });
  }

  // A failed write leaves the journal unable to describe what is sent next, so the run
  // stops before sending anything more.
  private async save(): Promise<boolean> {
    try {
      await this.deps.persist();
      return true;
    } catch (error) {
      const run = this.run;
      if (run && isRunActive(run)) {
        run.status = "paused";
        run.note = `Couldn't save progress, so nothing more will be sent. ${failureOf(error).message}`;
        run.nextAt = 0;
      }
      this.wake?.abort();
      this.note("Couldn't save progress. The run is paused.");
      this.changed();
      return false;
    }
  }

  async start(jobs: readonly Job[], options: StartOptions): Promise<void> {
    if (!jobs.length) return;
    const existing = this.run;
    if (existing && (isRunActive(existing) || existing.status === "paused")) return;
    const required = options.backup && jobs.some((job) => job.action === "delete");
    const nowMs = this.deps.now();
    this.deps.journal.run = {
      id: options.runId,
      accountId: this.deps.journal.accountId,
      status: required ? "backup" : "running",
      phase: required ? "backup" : "write",
      jobs: jobs.map((job) => ({ ...job, tries: 0 })),
      i: 0,
      results: [],
      startedAt: nowMs,
      lastWriteAt: 0,
      nextAt: 0,
      fails: 0,
      note: "",
      inflight: null,
      held: {},
      backup: { required, acceptIncomplete: options.acceptIncomplete, saved: null },
      finishedAt: null,
    };
    this.pending = null;
    this.note(`Started: ${plural(jobs.length, "change")}.`);
    if (!(await this.save())) return;
    this.kick();
  }

  async resume(): Promise<void> {
    const run = this.run;
    if (!run || run.status !== "paused") return;
    if (this.looping) {
      this.resumeAfter = true;
      return;
    }
    run.note = "";
    run.fails = 0;
    if (run.phase === "save") {
      if (this.pendingBackup()) {
        run.status = "saving";
        await this.save();
        this.changed();
        return;
      }
      // The collected backup lived only in memory; collect it again before any deletion.
      run.phase = "backup";
    }
    run.status = run.phase === "backup" ? "backup" : run.phase === "verify" ? "verifying" : "running";
    this.note("Resumed.");
    if (!(await this.save())) return;
    this.kick();
  }

  async pause(reason: string): Promise<void> {
    const run = this.run;
    if (!run || !isRunActive(run)) return;
    run.status = "paused";
    run.note = reason;
    run.nextAt = 0;
    this.wake?.abort();
    this.note(reason ? `Paused: ${reason}` : "Paused.");
    this.changed();
    await this.save();
  }

  async stop(): Promise<void> {
    const run = this.run;
    if (!run || run.status === "done" || run.status === "stopped") return;
    this.resumeAfter = false;
    run.status = "stopped";
    run.note = run.inflight ? "Stopped while a change was in flight; check that chat in ChatGPT." : "";
    run.nextAt = 0;
    run.finishedAt = this.deps.now();
    this.pending = null;
    this.wake?.abort();
    this.note("Stopped. Chats that weren't reached keep their marks.");
    this.changed();
    await this.save();
  }

  // A paused run with a change in flight must be resumed (to check it) or stopped first.
  canDismiss(): boolean {
    const run = this.run;
    return Boolean(run) && !this.isActive() && !(run?.status === "paused" && run.inflight);
  }

  async dismiss(): Promise<void> {
    if (!this.canDismiss()) return;
    this.deps.journal.run = null;
    this.pending = null;
    this.changed();
    await this.save();
  }

  async acknowledgeBackupSaved(proof: BackupProof): Promise<boolean> {
    const run = this.run;
    const pending = this.pendingBackup();
    if (!run || run.status !== "saving" || !pending || proof.sha256 !== pending.sha256) return false;
    run.backup.saved = {
      file: proof.file,
      sha256: proof.sha256,
      ids: [...pending.ids],
      verification: proof.verification,
      at: this.deps.now(),
    };
    run.phase = "write";
    run.status = "running";
    this.note(`Saved the backup of ${plural(pending.ids.length, "chat")} as ${proof.file}.`);
    if (!(await this.save())) return false;
    this.pending = null;
    this.kick();
    return true;
  }

  // A loop still unwinding from a stopped or replaced run is followed by a fresh one.
  private kick(): void {
    if (this.looping) {
      this.kickAfter = true;
      return;
    }
    const wake = new AbortController();
    this.wake = wake;
    this.looping = this.loop(wake.signal).finally(() => {
      this.looping = null;
      if (this.wake === wake) this.wake = null;
      this.changed();
      if (this.kickAfter) {
        this.kickAfter = false;
        if (this.isActive() && this.run?.status !== "saving") this.kick();
      }
      if (this.resumeAfter) {
        this.resumeAfter = false;
        void this.resume();
      }
    });
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

  private async settle(job: Job): Promise<Settled> {
    try {
      return satisfies(job, await this.deps.transport.probe(job.id)) ? "applied" : "not-applied";
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === "aborted") throw failure;
      if (failure.kind === "notfound") return job.action === "delete" ? "applied" : "gone";
      return "unknown";
    }
  }

  private complete(run: Run, job: Job, detail: string): void {
    applyToInventory(this.deps.chats, job, this.deps.now());
    delete this.deps.journal.marks[job.id];
    this.record(run, job, "done", detail);
    run.i += 1;
    run.fails = 0;
    run.inflight = null;
  }

  // Decides the outcome of a write that may have been sent. Returns true when the job
  // is settled and the queue may move on, false when it must be sent (again).
  private async reconcile(run: Run, job: Job, detail: string): Promise<boolean | "halt"> {
    const settled = await this.settle(job);
    if (settled === "applied") {
      this.complete(run, job, detail);
      return (await this.save()) ? true : "halt";
    }
    if (settled === "gone") {
      this.record(run, job, "failed", "Chat not found.");
      run.i += 1;
      run.inflight = null;
      return (await this.save()) ? true : "halt";
    }
    if (settled === "unknown") {
      if (run.inflight) run.inflight.outcome = "unknown";
      await this.pause(`Couldn't confirm whether the change to “${job.title}” went through. Check it in ChatGPT, then resume.`);
      return "halt";
    }
    run.inflight = null;
    return (await this.save()) ? false : "halt";
  }

  private async waitForCooldown(signal: AbortSignal): Promise<void> {
    const left = () => Math.max(0, this.deps.journal.cooldownUntil - this.deps.now());
    while (left() > 0) {
      await this.deps.sleep(Math.min(1000, left()), signal);
    }
  }

  private async loop(signal: AbortSignal): Promise<void> {
    const run = this.run;
    if (!run) return;
    const live = () => !signal.aborted && this.run === run && isRunActive(run);
    const set = (status: RunStatus) => {
      if (live()) run.status = status;
    };
    try {
      if (run.inflight) {
        const job = run.jobs[run.i];
        if (!job || job.id !== run.inflight.id) {
          await this.pause("The saved run doesn't match its in-flight change. Check ChatGPT before continuing.");
          return;
        }
        const settled = await this.reconcile(run, job, "Reconciled after an interruption; it was not sent again.");
        if (settled === "halt") return;
      }
      if (run.phase === "backup") {
        const next = await this.collectBackup(run, signal, set);
        if (next !== "write" || !live()) return;
      }
      if (run.phase === "write") {
        if (!(await this.writeAll(run, signal, set))) return;
        run.phase = "verify";
        set("verifying");
        if (!(await this.save())) return;
      }
      if (!live()) return;
      this.changed();
      await this.verify(run, live);
      if (!live()) return;
      run.status = "done";
      run.note = "";
      run.finishedAt = this.deps.now();
      const failed = run.results.filter((result) => result.status !== "done").length;
      this.note(`Finished. ${plural(run.results.length - failed, "change")} made${failed ? `, ${failed} need attention` : ""}.`);
      await this.save();
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind !== "aborted" && live()) await this.pause(failure.message);
    }
  }

  private async writeAll(run: Run, signal: AbortSignal, set: (status: RunStatus) => void): Promise<boolean> {
    const live = () => !signal.aborted && this.run === run && isRunActive(run);
    while (run.i < run.jobs.length) {
      if (!live()) return false;
      const job = run.jobs[run.i];
      if (!job) break;

      const withdrawn = this.withdrawn(job);
      if (withdrawn) {
        this.record(run, job, "held", withdrawn);
        run.i += 1;
        if (!(await this.save())) return false;
        this.changed();
        continue;
      }

      if (job.action === "delete" && run.backup.required) {
        const held = run.held[job.id];
        if (held) {
          this.record(run, job, "held", `Not deleted: it wasn't backed up. ${held} It's still marked.`);
          run.i += 1;
          if (!(await this.save())) return false;
          this.changed();
          continue;
        }
        if (!run.backup.saved?.ids.includes(job.id)) {
          await this.pause(`No saved backup includes “${job.title}”, so it wasn't deleted.`);
          return false;
        }
      }

      while (this.deps.journal.cooldownUntil > this.deps.now()) {
        set("waiting");
        run.nextAt = 0;
        this.changed();
        await this.waitForCooldown(signal);
      }
      const gap = run.lastWriteAt + scaled(this.deps.journal.settings.gap * 1000, this.scale) - this.deps.now();
      if (gap > 0) {
        set("running");
        run.nextAt = this.deps.now() + gap;
        this.changed();
        await this.deps.sleep(gap, signal);
      }
      if (!live()) return false;
      set("running");
      run.nextAt = 0;
      run.inflight = { id: job.id, sentAt: this.deps.now(), outcome: "sent" };
      if (!(await this.save())) {
        run.inflight = null;
        return false;
      }
      if (!live()) {
        run.inflight = null;
        await this.save();
        return false;
      }
      this.changed();

      let failure: TriageError | null = null;
      try {
        await this.deps.transport.writeChange(run, job);
      } catch (error) {
        failure = failureOf(error);
      }
      run.lastWriteAt = this.deps.now();

      if (!failure) {
        this.complete(run, job, "");
        job.tries = 0;
        if (!(await this.save())) return false;
        this.changed();
        continue;
      }

      if (mayHaveApplied(failure)) {
        const settled = await this.reconcile(run, job, "Confirmed with ChatGPT after an uncertain response; it was not sent again.");
        if (settled === "halt") return false;
        if (settled) {
          this.changed();
          continue;
        }
        job.tries += 1;
        if (job.tries <= this.config.transientBackoff.length) {
          run.note = `${failure.message} ChatGPT shows it didn't apply; trying again shortly.`;
          this.changed();
          await this.deps.sleep(scaled(this.config.transientBackoff[job.tries - 1] ?? 0, this.scale), signal);
          run.note = "";
          continue;
        }
      } else {
        run.inflight = null;
      }

      if (failure.kind === "ratelimit" || failure.kind === "cooldown") {
        if (failure.until > 0) this.deps.journal.cooldownUntil = Math.max(this.deps.journal.cooldownUntil, failure.until);
        if (!(await this.save())) return false;
        continue;
      }
      if (failure.kind === "auth") {
        await this.pause(failure.message);
        return false;
      }
      if (failure.kind === "notfound" && job.action === "delete") {
        this.complete(run, job, "It was already gone.");
        if (!(await this.save())) return false;
        continue;
      }
      this.record(run, job, "failed", failure.kind === "notfound" ? "Chat not found." : failure.message);
      run.i += 1;
      run.fails += 1;
      if (!(await this.save())) return false;
      this.changed();
      if (run.fails >= 3) {
        await this.pause("Three changes in a row failed. Check ChatGPT, then resume.");
        return false;
      }
    }
    return live();
  }

  // A chat protected, unmarked or re-marked after the run was reviewed is left alone.
  private withdrawn(job: Job): string | null {
    if (this.deps.journal.protect[job.id]) return "Not changed: it was protected after the run was reviewed.";
    const mark = this.deps.journal.marks[job.id];
    if (!mark) return "Not changed: its mark was cleared after the run was reviewed.";
    if (mark.action !== job.action) return "Not changed: it was marked differently after the run was reviewed.";
    return null;
  }

  private async collectBackup(
    run: Run,
    signal: AbortSignal,
    set: (status: RunStatus) => void,
  ): Promise<"saving" | "write" | "halt"> {
    const targets = run.jobs.filter((job) => job.action === "delete");
    const entries: BackupEntry[] = [];
    const held: Record<string, string> = {};
    let tries = 0;
    for (let index = 0; index < targets.length;) {
      if (signal.aborted) throw aborted();
      const job = targets[index];
      if (!job) break;
      set("backup");
      run.note = `Backing up chat ${index + 1} of ${targets.length} before deleting anything.`;
      this.changed();
      try {
        const record = await this.deps.transport.fetchRecord(job.id);
        const coverage = describeConversation(record);
        if (isIncomplete(coverage) && !run.backup.acceptIncomplete) {
          held[job.id] = `It has ${plural(coverage.images + coverage.attachments, "attachment or image file", "attachment or image files")} the backup can't include.`;
        } else {
          const createdMs = this.deps.chats.find((chat) => chat.id === job.id)?.createdMs ?? 0;
          entries.push({ id: job.id, title: job.title, createdMs, record, coverage });
        }
        tries = 0;
        index += 1;
        if (index < targets.length) await this.deps.sleep(scaled(this.config.backupGap, this.scale), signal);
      } catch (error) {
        const failure = failureOf(error);
        if (failure.kind === "aborted" || failure.kind === "auth") throw failure;
        if (failure.kind === "ratelimit" || failure.kind === "cooldown") {
          if (failure.until > 0) this.deps.journal.cooldownUntil = Math.max(this.deps.journal.cooldownUntil, failure.until);
          set("waiting");
          this.changed();
          await this.waitForCooldown(signal);
          continue;
        }
        if (failure.kind === "transient" && tries < this.config.transientBackoff.length) {
          await this.deps.sleep(scaled(this.config.transientBackoff[tries] ?? 0, this.scale), signal);
          tries += 1;
          continue;
        }
        held[job.id] = failure.kind === "notfound" ? "ChatGPT couldn't find it." : failure.message;
        tries = 0;
        index += 1;
      }
    }
    if (signal.aborted) throw aborted();
    run.held = held;
    run.note = "";
    const kept = Object.keys(held).length;
    if (kept) this.note(`Couldn't back up ${plural(kept, "chat")}, so ${kept === 1 ? "it won't" : "they won't"} be deleted.`);
    if (!entries.length) {
      run.phase = "write";
      set("running");
      return (await this.save()) ? "write" : "halt";
    }
    const built = await buildBackup({ accountId: run.accountId, runId: run.id, createdMs: run.startedAt }, entries);
    if (signal.aborted) throw aborted();
    this.pending = { ...built, runId: run.id };
    run.phase = "save";
    set("saving");
    this.note(`Collected a backup of ${plural(entries.length, "chat")}. Save it to continue; nothing is deleted until it is saved.`);
    return (await this.save()) ? "saving" : "halt";
  }

  private async verify(run: Run, live: () => boolean): Promise<void> {
    const done = run.results.filter((result) => result.status === "done");
    if (!done.length) return;
    run.note = "Double-checking with ChatGPT.";
    this.changed();
    let fresh: Chat[];
    let complete: boolean;
    try {
      ({ chats: fresh, complete } = await this.deps.transport.listActive());
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === "aborted") throw failure;
      run.note = `Couldn't double-check: ${failure.message}`;
      return;
    }
    const listed = new Map(fresh.map((chat) => [chat.id, chat]));
    const confirmed: Result[] = [];
    for (const result of done) {
      if (!live()) throw aborted();
      const job = jobOf(result);
      // Absence from a partial list proves nothing, so each change is probed directly.
      if (complete && listedSatisfies(job, listed.get(result.id))) {
        confirmed.push(result);
        continue;
      }
      const settled = await this.settle(job);
      if (settled === "applied") {
        confirmed.push(result);
        continue;
      }
      result.status = "unconfirmed";
      if (settled === "unknown") {
        result.note = "Couldn't re-check this change with ChatGPT. Check it there.";
        continue;
      }
      result.note = "ChatGPT still shows this chat unchanged. It's marked again so you can retry.";
      this.deps.journal.marks[result.id] = markFor(job, this.deps.now());
    }
    const keep = this.deps.chats.filter((chat) => !listed.has(chat.id)
      && (!complete || chat.archived || confirmed.some((result) => result.id === chat.id)));
    const merged = [...fresh, ...keep];
    for (const result of confirmed) applyToInventory(merged, jobOf(result), this.deps.now());
    this.deps.chats.splice(0, this.deps.chats.length, ...merged);
    run.note = "";
  }
}

export function clampGap(value: number, config: Config = CONFIG): number {
  return clamp(value, config.gapMin, config.gapMax);
}
