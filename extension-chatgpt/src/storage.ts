import { Schema } from "effect";
import { TriageError } from "./errors.ts";
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

const BackupStateSchema = Schema.Struct({
  required: Schema.Boolean,
  acceptIncomplete: Schema.Boolean,
  saved: Schema.Union([
    Schema.Struct({
      file: Schema.String,
      sha256: Schema.String,
      ids: Schema.Array(Schema.String),
      verification: Schema.Literals(["file", "confirmed"]),
      at: Schema.Number,
    }),
    Schema.Null,
  ]),
});

const RunSchema = Schema.Struct({
  id: Schema.String,
  accountId: Schema.String,
  status: Schema.Literals(["backup", "saving", "running", "waiting", "verifying", "paused", "stopped", "done"]),
  phase: Schema.Literals(["backup", "save", "write", "verify"]),
  jobs: Schema.Array(JobSchema),
  i: Schema.Number,
  results: Schema.Array(ResultSchema),
  startedAt: Schema.Number,
  lastWriteAt: Schema.Number,
  nextAt: Schema.Number,
  fails: Schema.Number,
  note: Schema.String,
  inflight: Schema.Union([
    Schema.Struct({ id: Schema.String, sentAt: Schema.Number, outcome: Schema.Literals(["sent", "unknown"]) }),
    Schema.Null,
  ]),
  held: Schema.Record(Schema.String, Schema.String),
  backup: BackupStateSchema,
  finishedAt: NullableNumber,
});

export const JournalSchema = Schema.Struct({
  accountId: Schema.String,
  marks: Schema.Record(Schema.String, MarkSchema),
  protect: Schema.Record(Schema.String, ProtectionSchema),
  settings: SettingsSchema,
  run: Schema.Union([RunSchema, Schema.Null]),
  cooldownUntil: Schema.Number,
});

// A stored journal that can't be read may describe an interrupted change, so it is
// never silently replaced: loading fails and changes stay off until it is resolved.
export function decodeJournal(value: unknown, accountId: string): Journal {
  if (value == null) return createJournal(accountId);
  let decoded: Schema.Schema.Type<typeof JournalSchema>;
  try {
    decoded = Schema.decodeUnknownSync(JournalSchema, { onExcessProperty: "error" })(value);
  } catch {
    throw new TriageError("compat", "The saved organizer journal for this account can't be read, so changes are switched off. Nothing was overwritten.");
  }
  if (decoded.accountId !== accountId) {
    throw new TriageError("compat", "The saved organizer journal belongs to a different account, so changes are switched off.");
  }
  if (decoded.run && decoded.run.accountId !== accountId) {
    throw new TriageError("compat", "The saved run belongs to a different account, so changes are switched off.");
  }
  const run = decoded.run;
  return {
    accountId: decoded.accountId,
    marks: { ...decoded.marks },
    protect: { ...decoded.protect },
    settings: { ...decoded.settings },
    run: run
      ? {
          ...run,
          jobs: run.jobs.map((job) => ({ ...job })),
          results: run.results.map((result) => ({ ...result })),
          inflight: run.inflight ? { ...run.inflight } : null,
          held: { ...run.held },
          backup: {
            ...run.backup,
            saved: run.backup.saved ? { ...run.backup.saved, ids: [...run.backup.saved.ids] } : null,
          },
        }
      : null,
    cooldownUntil: decoded.cooldownUntil,
  };
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
      values.set(journal.accountId, structuredClone(journal));
    },
  };
}

export function storageKey(accountId: string): string {
  return `chatgpt-organizer:v2:${accountId}`;
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

// Writes complete in call order, and each write stores the journal as it was when the
// write was requested. Awaiting the returned promise means that state is durable.
export function createSerialPersist(store: JournalStore, current: () => Journal): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    const snapshot = structuredClone(current());
    const next = tail.catch(() => undefined).then(() => store.save(snapshot));
    tail = next;
    return next;
  };
}
