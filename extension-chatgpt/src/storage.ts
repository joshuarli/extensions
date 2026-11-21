import { Schema } from "effect";
import { createJournal, type Journal } from "./model.ts";

const ActionSchema = Schema.Literals(["delete", "archive", "unarchive", "rename", "move", "protect"]);
const MutatingActionSchema = Schema.Literals(["delete", "archive", "unarchive", "rename", "move"]);
const NullableString = Schema.Union([Schema.String, Schema.Null]);
const NullableNumber = Schema.Union([Schema.Number, Schema.Null]);

const MarkSchema = Schema.Struct({
  action: ActionSchema,
  title: Schema.String,
  newTitle: NullableString,
  project: Schema.String,
  projectName: Schema.String,
  at: Schema.Number,
});

const ProtectionSchema = Schema.Struct({
  title: Schema.String,
  at: Schema.Number,
});

const SettingsSchema = Schema.Struct({
  gap: Schema.Number,
  backup: Schema.Boolean,
  pinnedInSelectAll: Schema.Boolean,
});

const JobSchema = Schema.Struct({
  id: Schema.String,
  action: MutatingActionSchema,
  newTitle: NullableString,
  title: Schema.String,
  project: Schema.String,
  projectName: Schema.String,
  tries: Schema.Number,
});

const ResultSchema = Schema.Struct({
  id: Schema.String,
  action: MutatingActionSchema,
  title: Schema.String,
  newTitle: NullableString,
  project: Schema.String,
  projectName: Schema.String,
  status: Schema.Literals(["done", "held", "failed", "unconfirmed"]),
  note: Schema.String,
  at: Schema.Number,
});

const RunSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["backup", "saving", "running", "waiting", "verifying", "paused", "stopped", "done"]),
  phase: Schema.Literals(["backup", "save", "write", "verify"]),
  jobs: Schema.Array(JobSchema),
  i: Schema.Number,
  results: Schema.Array(ResultSchema),
  startedAt: Schema.Number,
  owner: Schema.String,
  beat: Schema.Number,
  lastWriteAt: Schema.Number,
  nextAt: Schema.Number,
  fails: Schema.Number,
  note: Schema.String,
  current: NullableString,
  held: Schema.Record(Schema.String, Schema.String),
  backupCount: Schema.Number,
  backupFile: NullableString,
  backupDownloaded: NullableString,
  finishedAt: NullableNumber,
});

export const JournalSchema = Schema.Struct({
  accountId: Schema.String,
  marks: Schema.Record(Schema.String, MarkSchema),
  protect: Schema.Record(Schema.String, ProtectionSchema),
  seen: Schema.Record(Schema.String, Schema.Number),
  settings: SettingsSchema,
  run: Schema.Union([RunSchema, Schema.Null]),
  cooldownUntil: Schema.Number,
  strikes: Schema.Number,
});

export function decodeJournal(value: unknown, fallbackAccountId: string): Journal {
  if (value == null) return createJournal(fallbackAccountId);
  try {
    const decoded = Schema.decodeUnknownSync(JournalSchema)(value);
    return {
      accountId: decoded.accountId,
      marks: { ...decoded.marks },
      protect: { ...decoded.protect },
      seen: { ...decoded.seen },
      settings: { ...decoded.settings },
      run: decoded.run
        ? {
            ...decoded.run,
            jobs: decoded.run.jobs.map((job) => ({ ...job })),
            results: decoded.run.results.map((result) => ({ ...result })),
            held: { ...decoded.run.held },
          }
        : null,
      cooldownUntil: decoded.cooldownUntil,
      strikes: decoded.strikes,
    };
  } catch {
    return createJournal(fallbackAccountId);
  }
}

export interface JournalStore {
  load(accountId: string): Promise<Journal>;
  save(journal: Journal): Promise<void>;
}

export function createMemoryJournalStore(seed: Record<string, unknown> = {}): JournalStore {
  const values = new Map<string, unknown>(Object.entries(seed));
  return {
    async load(accountId) {
      return decodeJournal(values.get(accountId), accountId);
    },
    async save(journal) {
      values.set(journal.accountId, journal);
    },
  };
}

export function storageKey(accountId: string): string {
  return `chatgpt-triage:v1:${accountId}`;
}

export function createChromeJournalStore(storage: Pick<typeof chrome.storage, "local">): JournalStore {
  return {
    async load(accountId) {
      const result = await storage.local.get(storageKey(accountId));
      return decodeJournal(result[storageKey(accountId)], accountId);
    },
    async save(journal) {
      await storage.local.set({ [storageKey(journal.accountId)]: journal });
    },
  };
}
