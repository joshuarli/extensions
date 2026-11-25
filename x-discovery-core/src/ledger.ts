import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Schema } from "effect";

export const FindStatusSchema = Schema.Literals(["seen", "followed"]);
export type FindStatus = Schema.Schema.Type<typeof FindStatusSchema>;

export const FindRecordSchema = Schema.Struct({
  tweet_id: Schema.String,
  author_id: Schema.String,
  author_handle: Schema.String,
  source_url: Schema.String,
  topic_score: Schema.Number,
  links: Schema.Array(Schema.String),
  note: Schema.String,
  discovered_at: Schema.String,
  status: FindStatusSchema,
  followed_at: Schema.optional(Schema.String),
});

export type FindRecord = Schema.Schema.Type<typeof FindRecordSchema>;

function withLock<T>(path: string, work: () => T): T {
  const lock = path + ".lock";
  const staleMs = 60_000;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > staleMs) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for the ledger lock at " + lock + ".");
    }
  }
  try {
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function atomicWrite(path: string, records: readonly FindRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, records.map((record) => JSON.stringify(record)).join("\n") + "\n", { mode: 0o644 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function readLedger(path: string): FindRecord[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error("Corrupt find record at line " + (index + 1) + " of " + path + ": "
        + (error instanceof Error ? error.message : String(error)));
    }
    try {
      return [Schema.decodeUnknownSync(FindRecordSchema)(parsed)];
    } catch (error) {
      throw new Error("Invalid find record at line " + (index + 1) + " of " + path + ": "
        + (error instanceof Error ? error.message : String(error)));
    }
  });
}

export function appendFinds(path: string, records: readonly FindRecord[]): { added: number; duplicates: number } {
  return withLock(path, () => {
    const existing = readLedger(path);
    const known = new Set(existing.map((record) => record.tweet_id));
    const fresh = records.filter((record) => {
      if (known.has(record.tweet_id)) return false;
      known.add(record.tweet_id);
      return true;
    });
    if (fresh.length > 0) atomicWrite(path, [...existing, ...fresh]);
    return { added: fresh.length, duplicates: records.length - fresh.length };
  });
}

export function markFollowed(path: string, authorIds: readonly string[], at: string = new Date().toISOString()): number {
  return withLock(path, () => {
    const records = readLedger(path);
    const targets = new Set(authorIds);
    let changed = 0;
    const updated = records.map((record) => {
      if (!targets.has(record.author_id) || record.status === "followed") return record;
      changed++;
      return { ...record, status: "followed" as const, followed_at: at };
    });
    if (changed > 0) atomicWrite(path, updated);
    return changed;
  });
}
