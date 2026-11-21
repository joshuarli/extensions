import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/api.ts";
import { TriageError } from "../src/errors.ts";
import {
  buildJobs,
  createJournal,
  type Chat,
  type Conversation,
  type ConversationProbe,
  type Job,
  type Mark,
  type Run,
} from "../src/model.ts";
import { QueueRunner, type QueueEvent, type QueueTransport } from "../src/queue.ts";
import { createClock, makeChat } from "./helpers.ts";

function mark(action: Mark["action"], extra: Partial<Mark> = {}): Mark {
  return {
    action,
    title: "Chat a",
    newTitle: action === "rename" ? "Renamed" : null,
    project: action === "move" ? "p1" : "",
    projectName: action === "move" ? "Project 1" : "",
    at: 0,
    ...extra,
  };
}

function job(id: string, action: Job["action"]): Job {
  return {
    id,
    action,
    newTitle: action === "rename" ? "Renamed" : null,
    title: `Chat ${id}`,
    project: action === "move" ? "p1" : "",
    projectName: action === "move" ? "Project 1" : "",
    tries: 0,
  };
}

function baseRun(jobs: Job[]): Run {
  return {
    id: "run-1",
    status: "running",
    phase: "write",
    jobs,
    i: 0,
    results: [],
    startedAt: 0,
    owner: "owner-1",
    beat: 0,
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
}

interface Options {
  chats?: Chat[];
  marks?: Record<string, Mark>;
  run?: Partial<Run>;
  write?: (current: Job) => void | Promise<void>;
  probe?: (id: string) => ConversationProbe;
  list?: () => Promise<Chat[]>;
  conversation?: (id: string) => Conversation;
  gap?: number;
}

function makeEnv(options: Options) {
  const clock = createClock();
  const journal = createJournal("u1");
  journal.marks = options.marks ?? {};
  journal.settings.gap = options.gap ?? 0;
  if (options.run) journal.run = { ...baseRun(options.run.jobs ?? []), ...options.run };
  const chats: Chat[] = (options.chats ?? []).map((chat) => ({ ...chat }));
  const writes: string[] = [];
  const events: QueueEvent[] = [];
  const transport: QueueTransport = {
    async getConversation(id) {
      const conversation = options.conversation?.(id) ?? { title: `Chat ${id}`, messages: [], search: "" };
      if (conversation instanceof Error) throw conversation;
      return conversation;
    },
    async writeChange(current) {
      writes.push(`${current.action}:${current.id}`);
      await options.write?.(current);
    },
    async listActive() {
      return options.list ? options.list() : chats.filter((chat) => !chat.archived).map((chat) => ({ ...chat }));
    },
    async probe(id) {
      return options.probe?.(id) ?? { archived: false, visible: true, projectId: null, title: `Chat ${id}` };
    },
  };
  const runner = new QueueRunner({
    transport,
    journal,
    chats,
    now: clock.now,
    sleep: clock.sleep,
    persist: () => undefined,
    owner: "owner-1",
    onEvent: (event) => events.push(event),
    config: { ...CONFIG },
  });
  return { clock, journal, chats, writes, events, runner };
}

describe("resumable operation queue", () => {
  it("waits out a rate limit and retries the same job, without duplicating a deletion", async () => {
    let attempt = 0;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete") },
      write: () => {
        attempt += 1;
        if (attempt === 1) {
          const until = env.clock.now() + 3000;
          env.journal.cooldownUntil = until;
          throw new TriageError("ratelimit", "too many requests", until);
        }
      },
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a", "delete:a"]);
    expect(env.journal.run?.status).toBe("done");
    expect(env.journal.marks["a"]).toBeUndefined();
  });

  it("reconciles an interrupted in-flight change instead of sending it again", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete") },
      run: { jobs: [job("a", "delete")], status: "paused", phase: "write", current: "a" },
      probe: () => ({ archived: false, visible: false, projectId: null, title: null }),
    });
    env.runner.resume();
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual([]);
    expect(env.journal.marks["a"]).toBeUndefined();
    expect(env.journal.run?.results[0]?.status).toBe("done");
    expect(env.journal.run?.results[0]?.note).toContain("Reconciled");
  });

  it("backs up before deleting and never deletes a chat that could not be backed up", async () => {
    const env = makeEnv({
      chats: [makeChat("a"), makeChat("b")],
      marks: { a: mark("delete"), b: mark("delete", { title: "Chat b" }) },
      conversation: (id) => {
        if (id === "a") throw new Error("unreadable");
        return { title: "Chat b", messages: [{ role: "user", text: "hello", timeMs: 0 }], search: "hello" };
      },
    });
    env.runner.start({ backup: true });
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("saving");
    expect(env.writes).toEqual([]);
    expect(Object.keys(env.journal.run?.held ?? {})).toEqual(["a"]);

    env.runner.acknowledgeBackupSaved("backup.md");
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:b"]);
    expect(env.journal.run?.results.find((result) => result.id === "a")?.status).toBe("held");
    expect(env.journal.run?.results.find((result) => result.id === "b")?.status).toBe("done");
  });

  it("does not wait for a backup when every delete target was held", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete") },
      conversation: () => { throw new Error("unreadable"); },
    });
    env.runner.start({ backup: true });
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("done");
    expect(env.writes).toEqual([]);
    expect(env.journal.run?.results[0]?.status).toBe("held");
  });

  it("flags a phantom success as unconfirmed and restores its mark after verification", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("archive") },
      list: async () => [makeChat("a")],
      probe: () => ({ archived: false, visible: true, projectId: null, title: null }),
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["archive:a"]);
    expect(env.journal.run?.results[0]?.status).toBe("unconfirmed");
    expect(env.journal.marks["a"]?.action).toBe("archive");
  });

  it("treats a missing chat as an already-applied delete", async () => {
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete") },
      write: () => { throw new TriageError("notfound", "gone"); },
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.results[0]?.status).toBe("done");
    expect(env.journal.run?.results[0]?.note).toContain("already gone");
  });

  it("pauses after three consecutive failures and keeps marks for unapplied changes", async () => {
    const env = makeEnv({
      chats: [makeChat("a"), makeChat("b"), makeChat("c")],
      marks: {
        a: mark("delete"),
        b: mark("delete", { title: "Chat b" }),
        c: mark("delete", { title: "Chat c" }),
      },
      write: () => { throw new TriageError("http", "boom"); },
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.journal.run?.status).toBe("paused");
    expect(env.journal.run?.results.filter((result) => result.status === "failed")).toHaveLength(3);
    expect(Object.keys(env.journal.marks)).toHaveLength(3);
  });

  it("retries transient failures with backoff before giving up", async () => {
    let attempt = 0;
    const env = makeEnv({
      chats: [makeChat("a")],
      marks: { a: mark("delete") },
      write: () => {
        attempt += 1;
        if (attempt <= 2) throw new TriageError("transient", "server error");
      },
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.writes).toHaveLength(3);
    expect(env.journal.run?.results[0]?.status).toBe("done");
  });

  it("resumes a paused run from the same job without repeating completed work", async () => {
    let calls = 0;
    const env = makeEnv({
      chats: [makeChat("a"), makeChat("b")],
      marks: {
        a: mark("delete"),
        b: mark("delete", { title: "Chat b" }),
      },
      write: () => {
        calls += 1;
        if (calls === 2) throw new TriageError("auth", "sign-in expired");
      },
    });
    env.runner.start({ backup: false });
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a", "delete:b"]);
    expect(env.journal.run?.status).toBe("paused");

    env.runner.resume();
    await env.runner.waitUntilIdle();
    expect(env.writes).toEqual(["delete:a", "delete:b", "delete:b"]);
    expect(env.journal.run?.status).toBe("done");
  });

  it("orders jobs oldest first and excludes protected chats", () => {
    const journal = createJournal("u1");
    journal.marks = {
      b: mark("delete", { title: "Chat b" }),
      a: mark("archive"),
    };
    journal.protect = { b: { title: "Chat b", at: 0 } };
    const chats = [makeChat("a", { createdMs: 100 }), makeChat("b", { createdMs: 200 })];
    expect(buildJobs(journal, chats).map((entry) => entry.id)).toEqual(["a"]);
  });
});
