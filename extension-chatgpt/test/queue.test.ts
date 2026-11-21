import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/api.ts";
import { TriageError } from "../src/errors.ts";
import {
  buildJobs,
  createJournal,
  recoverInterrupted,
  runControls,
  type Chat,
  type ConversationProbe,
  type Job,
  type Journal,
  type Mark,
} from "../src/model.ts";
import { QueueRunner, type QueueEvent, type QueueTransport } from "../src/queue.ts";
import { decodeJournal } from "../src/storage.ts";
import { createClock, makeChat } from "./helpers.ts";

function mark(action: Mark["action"], title: string, extra: Partial<Mark> = {}): Mark {
  return {
    action,
    title,
    newTitle: action === "rename" ? "Renamed" : null,
    project: action === "move" ? "g-p-work" : "",
    projectName: action === "move" ? "Work" : "",
    at: 0,
    ...extra,
  };
}

interface ServerChat {
  archived: boolean;
  visible: boolean;
  projectId: string | null;
  title: string;
}

type Server = Map<string, ServerChat>;

function serverFrom(chats: Chat[]): Server {
  return new Map(chats.map((chat) => [chat.id, { archived: chat.archived, visible: true, projectId: chat.projectId, title: chat.title }]));
}

function applyOnServer(server: Server, job: Job): void {
  const chat = server.get(job.id);
  if (!chat) throw new TriageError("notfound", "Chat not found.");
  if (job.action === "delete") chat.visible = false;
  if (job.action === "archive") chat.archived = true;
  if (job.action === "unarchive") chat.archived = false;
  if (job.action === "rename") chat.title = job.newTitle ?? chat.title;
  if (job.action === "move") chat.projectId = job.project || null;
}

function record(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: `Chat ${id}`,
    is_archived: false,
    current_node: "m1",
    mapping: {
      root: { id: "root", parent: null, message: null },
      m1: { id: "m1", parent: "root", message: { author: { role: "user" }, content: { content_type: "text", parts: [`hello ${id}`] } } },
    },
    ...extra,
  };
}

interface Options {
  chats: Chat[];
  marks: Record<string, Mark>;
  journal?: Journal;
  server?: Server;
  // Runs before the server applies a write; throwing means the write never arrived.
  beforeApply?: (job: Job, attempt: number) => void;
  // Runs after the server applied a write; throwing models a lost response.
  afterApply?: (job: Job, attempt: number) => void;
  probe?: (id: string, server: Server) => ConversationProbe;
  fetchRecord?: (id: string) => unknown;
  onList?: () => Promise<void>;
  // The list still shows every chat as it was before the run.
  listLags?: boolean;
  persist?: (call: number) => Promise<void> | void;
}

interface Violation {
  id: string;
  problem: string;
}

function makeEnv(options: Options) {
  const clock = createClock();
  const journal = options.journal ?? createJournal("u1");
  if (!options.journal) {
    journal.marks = { ...options.marks };
    journal.settings.gap = 3;
  }
  const chats: Chat[] = options.chats.map((chat) => ({ ...chat }));
  const server = options.server ?? serverFrom(chats);
  const writes: string[] = [];
  const attempts = new Map<string, number>();
  const events: QueueEvent[] = [];
  const snapshots: { journal: Journal; server: Server }[] = [];
  const violations: Violation[] = [];
  let persistCalls = 0;
  const durable = (): Journal | undefined => snapshots[snapshots.length - 1]?.journal;
  const transport: QueueTransport = {
    async fetchRecord(id) {
      return options.fetchRecord ? options.fetchRecord(id) : record(id);
    },
    async writeChange(run, job) {
      const saved = durable()?.run;
      if (saved?.inflight?.id !== job.id) violations.push({ id: job.id, problem: "sent without a durable intent" });
      if (job.action === "delete" && run.backup.required && !saved?.backup.saved?.ids.includes(job.id)) {
        violations.push({ id: job.id, problem: "deleted without a durable saved backup" });
      }
      const attempt = (attempts.get(job.id) ?? 0) + 1;
      attempts.set(job.id, attempt);
      writes.push(`${job.action}:${job.id}`);
      options.beforeApply?.(job, attempt);
      applyOnServer(server, job);
      options.afterApply?.(job, attempt);
    },
    async listActive() {
      await options.onList?.();
      if (options.listLags) return options.chats.map((chat) => ({ ...chat }));
      return [...server.entries()]
        .filter(([, chat]) => chat.visible && !chat.archived)
        .map(([id, chat]) => makeChat(id, { title: chat.title, projectId: chat.projectId }));
    },
    async probe(id) {
      if (options.probe) return options.probe(id, server);
      const chat = server.get(id);
      if (!chat) throw new TriageError("notfound", "Chat not found.");
      return { archived: chat.archived, visible: chat.visible, projectId: chat.projectId, title: chat.title };
    },
  };
  const runner = new QueueRunner({
    transport,
    journal,
    chats,
    now: clock.now,
    sleep: clock.sleep,
    persist: async () => {
      persistCalls += 1;
      const snapshot = structuredClone(journal);
      await options.persist?.(persistCalls);
      snapshots.push({ journal: snapshot, server: structuredClone(server) });
    },
    onEvent: (event) => events.push(event),
    config: { ...CONFIG },
  });
  const start = (backup: boolean, acceptIncomplete = false) =>
    runner.start(buildJobs(journal, chats).jobs, { runId: "run-1", backup, acceptIncomplete });
  return { clock, journal, chats, server, writes, events, runner, snapshots, violations, start };
}

async function saveBackupWhenAsked(env: ReturnType<typeof makeEnv>): Promise<void> {
  await env.runner.waitUntilIdle();
  const pending = env.runner.pendingBackup();
  if (env.journal.run?.status !== "saving" || !pending) return;
  expect(await env.runner.acknowledgeBackupSaved({ file: "backup.json", sha256: pending.sha256, verification: "file" })).toBe(true);
  await env.runner.waitUntilIdle();
}

const fourChats = [
  makeChat("a", { createdMs: 1 }),
  makeChat("b", { createdMs: 2 }),
  makeChat("c", { createdMs: 3 }),
  makeChat("d", { createdMs: 4 }),
];

const fourMarks = {
  a: mark("delete", "Chat a"),
  b: mark("archive", "Chat b"),
  c: mark("rename", "Chat c"),
  d: mark("move", "Chat d"),
};

describe("backup before deletion", () => {
  it("shows the save control, not pause, once a backup is collected", async () => {
    const env = makeEnv({ chats: fourChats, marks: fourMarks });
    await env.start(true);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("saving");
    expect(runControls(env.journal.run)).toBe("save-backup");
    expect(env.writes).toEqual([]);
  });

  it("re-collects instead of deleting when a run paused in the save phase is resumed", async () => {
    const env = makeEnv({ chats: fourChats, marks: fourMarks });
    await env.start(true);
    await env.runner.waitUntilIdle();
    await env.runner.pause("Paused by you.");
    await env.runner.resume();
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("saving");
    expect(env.writes).toEqual([]);
  });

  it("re-collects after a restart in the save phase, because the collected backup was only in memory", async () => {
    const first = makeEnv({ chats: fourChats, marks: fourMarks });
    await first.start(true);
    await first.runner.waitUntilIdle();
    const stored = decodeJournal(structuredClone(first.journal), "u1");
    recoverInterrupted(stored);
    expect(stored.run?.status).toBe("paused");

    const second = makeEnv({ chats: fourChats, marks: {}, journal: stored });
    await second.runner.resume();
    await second.runner.waitUntilIdle();
    expect(second.journal.run?.phase).toBe("save");
    expect(second.journal.run?.status).toBe("saving");
    expect(second.writes).toEqual([]);
    await saveBackupWhenAsked(second);
    expect(second.writes).toContain("delete:a");
    expect(second.violations).toEqual([]);
  });

  it("refuses an acknowledgement for a different backup", async () => {
    const env = makeEnv({ chats: fourChats, marks: fourMarks });
    await env.start(true);
    await env.runner.waitUntilIdle();
    expect(await env.runner.acknowledgeBackupSaved({ file: "x.json", sha256: "0".repeat(64), verification: "file" })).toBe(false);
    expect(env.journal.run?.backup.saved).toBeNull();
    expect(env.writes).toEqual([]);
  });

  it("checks the saved backup at each delete, independently of the run phase", async () => {
    const env = makeEnv({ chats: fourChats, marks: fourMarks });
    await env.start(true);
    await env.runner.waitUntilIdle();
    const run = env.journal.run;
    if (!run) throw new Error("no run");
    run.phase = "write";
    run.status = "paused";
    await env.runner.resume();
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual([]);
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.note).toContain("No saved backup");
  });

  it("never deletes a chat that could not be backed up, and saves the rest", async () => {
    const env = makeEnv({
      chats: [makeChat("a", { createdMs: 1 }), makeChat("b", { createdMs: 2 })],
      marks: { a: mark("delete", "Chat a"), b: mark("delete", "Chat b") },
      fetchRecord: (id) => {
        if (id === "a") throw new TriageError("http", "unreadable");
        return record(id);
      },
    });
    await env.start(true);
    await saveBackupWhenAsked(env);
    expect(env.writes).toEqual(["delete:b"]);
    expect(env.journal.run?.results.map((result) => `${result.id}:${result.status}`)).toEqual(["a:held", "b:done"]);
    expect(env.journal.marks["a"]?.action).toBe("delete");
  });

  it("holds chats with attachments unless the documented limitation was accepted", async () => {
    const withImage = (id: string) => record(id, {
      mapping: {
        root: { id: "root", parent: null, message: null },
        m1: { id: "m1", parent: "root", message: { author: { role: "user" }, content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer" }] } } },
      },
    });
    const held = makeEnv({ chats: [makeChat("a")], marks: { a: mark("delete", "Chat a") }, fetchRecord: withImage });
    await held.start(true);
    await saveBackupWhenAsked(held);
    expect(held.writes).toEqual([]);
    expect(held.journal.run?.results[0]?.status).toBe("held");

    const accepted = makeEnv({ chats: [makeChat("a")], marks: { a: mark("delete", "Chat a") }, fetchRecord: withImage });
    await accepted.start(true, true);
    await saveBackupWhenAsked(accepted);
    expect(accepted.writes).toEqual(["delete:a"]);
  });
});

describe("durable writes", () => {
  it("does not send a change until its intent is durable", async () => {
    let release: () => void = () => undefined;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive", "Chat a") },
      persist: (call) => (call === 2 ? new Promise<void>((resolve) => { release = resolve; }) : undefined),
    });
    await env.start(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(env.writes).toEqual([]);
    release();
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["archive:a"]);
    expect(env.violations).toEqual([]);
  });

  it("fails closed when progress can't be saved", async () => {
    const env = makeEnv({
      chats: [makeChat("a"), makeChat("b")],
      marks: { a: mark("archive", "Chat a"), b: mark("archive", "Chat b") },
      persist: (call) => {
        if (call === 2) throw new Error("QUOTA_BYTES quota exceeded");
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual([]);
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.note).toContain("Couldn't save progress");
  });

  it("confirms an applied change after a lost response instead of resending it", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive", "Chat a") },
      afterApply: (_job, attempt) => {
        if (attempt === 1) throw new TriageError("transient", "ChatGPT had a server error (HTTP 502).");
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["archive:a"]);
    expect(env.journal.run?.results[0]?.status).toBe("done");
    expect(env.journal.run?.results[0]?.note).toContain("uncertain response");
  });

  it("retries only after ChatGPT shows that an uncertain change didn't apply", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive", "Chat a") },
      beforeApply: (_job, attempt) => {
        if (attempt <= 2) throw new TriageError("transient", "Network error.");
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["archive:a", "archive:a", "archive:a"]);
    expect(env.journal.run?.results[0]?.status).toBe("done");
  });

  it("pauses with an unknown outcome when the change can't be checked, and checks again on resume", async () => {
    let probeWorks = false;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete", "Chat a") },
      afterApply: () => { throw new TriageError("offline", "The ChatGPT tab did not answer."); },
      probe: (id, server) => {
        if (!probeWorks) throw new TriageError("transient", "Network error.");
        const chat = server.get(id);
        return { archived: false, visible: chat?.visible ?? false, projectId: null, title: null };
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.inflight).toMatchObject({ id: "a", outcome: "unknown" });
    probeWorks = true;
    await env.runner.resume();
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a"]);
    expect(env.journal.run?.status).toBe("done");
  });

  it("waits out a rate limit and sends the same change once more", async () => {
    let first = true;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete", "Chat a") },
      beforeApply: () => {
        if (!first) return;
        first = false;
        throw new TriageError("ratelimit", "too many requests", env.clock.now() + 3000);
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a", "delete:a"]);
    expect(env.journal.run?.status).toBe("done");
  });

  it("pauses after three consecutive definite failures and keeps their marks", async () => {
    const env = makeEnv({
      chats: [makeChat("a"), makeChat("b"), makeChat("c")],
      marks: { a: mark("archive", "Chat a"), b: mark("archive", "Chat b"), c: mark("archive", "Chat c") },
      beforeApply: () => { throw new TriageError("http", "HTTP 400"); },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.results.filter((result) => result.status === "failed")).toHaveLength(3);
    expect(Object.keys(env.journal.marks)).toHaveLength(3);
  });
});

describe("pause and stop", () => {
  it("doesn't send a change whose intent was being saved when the user paused", async () => {
    let release: () => void = () => undefined;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive", "Chat a") },
      persist: (call) => (call === 2 ? new Promise<void>((resolve) => { release = resolve; }) : undefined),
    });
    await env.start(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pausing = env.runner.pause("Paused by you.");
    release();
    await pausing;
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual([]);
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.inflight).toBeNull();
  });

  it("keeps a stop made during verification", async () => {
    let stop: () => Promise<void> = async () => undefined;
    const env = makeEnv({ chats: [makeChat("a")], marks: { a: mark("archive", "Chat a") }, onList: () => stop() });
    stop = () => env.runner.stop();
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("stopped");
  });

  it("keeps a stop made while the last change is being re-checked", async () => {
    let stop: () => Promise<void> = async () => undefined;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete", "Chat a") },
      listLags: true,
      probe: (_id, server) => {
        void stop();
        return { archived: false, visible: server.get("a")?.visible ?? true, projectId: null, title: null };
      },
    });
    stop = () => env.runner.stop();
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a"]);
    expect(env.journal.run?.status).toBe("stopped");
  });
});

describe("verification", () => {
  it("re-marks a change ChatGPT reported but didn't apply", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive", "Chat a") },
      afterApply: (job) => {
        const chat = env.server.get(job.id);
        if (chat) chat.archived = false;
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.results[0]?.status).toBe("unconfirmed");
    expect(env.journal.marks["a"]?.action).toBe("archive");
  });

  it("re-checks renames and unarchives, not only removals", async () => {
    const env = makeEnv({
      chats: [makeChat("a", { createdMs: 1 }), makeChat("b", { createdMs: 2, archived: true })],
      marks: { a: mark("rename", "Chat a"), b: mark("unarchive", "Chat b") },
      afterApply: (job) => {
        const chat = env.server.get(job.id);
        if (chat && job.action === "rename") chat.title = "Chat a";
        if (chat && job.action === "unarchive") chat.archived = true;
      },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.results.map((result) => result.status)).toEqual(["unconfirmed", "unconfirmed"]);
  });

  it("keeps archived chats in the inventory after a run", async () => {
    const env = makeEnv({
      chats: [makeChat("a", { createdMs: 1 }), makeChat("z", { archived: true })],
      marks: { a: mark("archive", "Chat a") },
    });
    await env.start(false);
    await env.runner.waitUntilIdle();
    expect(env.chats.filter((chat) => chat.archived).map((chat) => chat.id).sort()).toEqual(["a", "z"]);
  });
});

describe("crash consistency", () => {
  // Restart from every durable state of a run (with a lost response on one write) and
  // check that each restart finishes the run without breaking an invariant.
  it("recovers from a crash after any durable write", async () => {
    const options = {
      chats: fourChats,
      marks: fourMarks,
      afterApply: (job: Job, attempt: number) => {
        if (job.id === "c" && attempt === 1) throw new TriageError("transient", "Network error.");
      },
    };
    const reference = makeEnv(options);
    await reference.start(true);
    await saveBackupWhenAsked(reference);
    expect(reference.journal.run?.status).toBe("done");
    expect(reference.violations).toEqual([]);
    expect(reference.snapshots.length).toBeGreaterThan(8);

    for (const [index, snapshot] of reference.snapshots.entries()) {
      const stored = decodeJournal(structuredClone(snapshot.journal), "u1");
      recoverInterrupted(stored);
      const server = structuredClone(snapshot.server);
      const env = makeEnv({ chats: fourChats, marks: {}, journal: stored, server });
      for (let round = 0; round < 4 && env.journal.run?.status !== "done"; round += 1) {
        await env.runner.resume();
        await saveBackupWhenAsked(env);
      }
      const context = `restart from snapshot ${index}`;
      expect(env.journal.run?.status, context).toBe("done");
      expect(env.violations, context).toEqual([]);
      expect(server.get("a")?.visible, context).toBe(false);
      expect(server.get("b")?.archived, context).toBe(true);
      expect(server.get("c")?.title, context).toBe("Renamed");
      expect(server.get("d")?.projectId, context).toBe("g-p-work");
      expect(env.journal.run?.results.every((result) => result.status === "done"), context).toBe(true);
      expect(Object.keys(env.journal.marks), context).toEqual([]);
    }
  });
});
