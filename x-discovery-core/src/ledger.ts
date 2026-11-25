import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export function readLedger(path: string): FindRecord[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    const parsed: unknown = JSON.parse(line);
    try {
      return [Schema.decodeUnknownSync(FindRecordSchema)(parsed)];
    } catch (error) {
      throw new Error("Invalid find record at line " + (index + 1) + " of " + path + ": "
        + (error instanceof Error ? error.message : String(error)));
    }
  });
}

export function appendFinds(path: string, records: readonly FindRecord[]): { added: number; duplicates: number } {
  const known = new Set(readLedger(path).map((record) => record.tweet_id));
  const fresh = records.filter((record) => {
    if (known.has(record.tweet_id)) return false;
    known.add(record.tweet_id);
    return true;
  });
  if (fresh.length > 0) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, fresh.map((record) => JSON.stringify(record)).join("\n") + "\n", { mode: 0o644 });
  }
  return { added: fresh.length, duplicates: records.length - fresh.length };
}

export function markFollowed(path: string, authorIds: readonly string[], at: string = new Date().toISOString()): number {
  const records = readLedger(path);
  const targets = new Set(authorIds);
  let changed = 0;
  const updated = records.map((record) => {
    if (!targets.has(record.author_id) || record.status === "followed") return record;
    changed++;
    return { ...record, status: "followed" as const, followed_at: at };
  });
  if (changed > 0) {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = path + ".tmp";
    writeFileSync(temporary, updated.map((record) => JSON.stringify(record)).join("\n") + "\n", { mode: 0o644 });
    renameSync(temporary, path);
  }
  return changed;
}
