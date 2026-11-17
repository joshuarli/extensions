import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { BookmarkSchema, type Bookmark } from "../../x-archive-core/src/parser.ts";
import { mergeBookmark } from "../../x-archive-core/src/merge.ts";
import {
  ProfileScanStateSchema,
  type ProfileScanState,
} from "../../x-archive-core/src/storage.ts";
import type { ProfileStore } from "../../x-archive-core/src/collector.ts";

const SCHEMA_VERSION = "1";

export const PROFILE_DB_NAME = "archive.db";

export function profileDbPath(profileDir: string): string {
  return join(profileDir, PROFILE_DB_NAME);
}

export class SqliteProfileStore implements ProfileStore {
  private readonly db: DatabaseSync;
  readonly targetUserId: string;
  readonly path: string;

  constructor(path: string, targetUserId: string) {
    if (!/^\d+$/u.test(targetUserId)) throw new Error("Invalid X target user id.");
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.targetUserId = targetUserId;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
      + "CREATE TABLE IF NOT EXISTS posts ("
      + "  target_user_id TEXT NOT NULL,"
      + "  tweet_id TEXT NOT NULL,"
      + "  json TEXT NOT NULL,"
      + "  PRIMARY KEY (target_user_id, tweet_id)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS state ("
      + "  target_user_id TEXT PRIMARY KEY,"
      + "  json TEXT NOT NULL"
      + ")",
    );
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (row === undefined) {
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
    } else if (row.value !== SCHEMA_VERSION) {
      this.db.close();
      throw new Error("Unsupported archive.db schema version: " + row.value);
    }
  }

  close(): void {
    this.db.close();
  }

  async savePage(items: Bookmark[], targetUserId: string): Promise<void> {
    if (items.length === 0) return;
    if (targetUserId !== this.targetUserId) throw new Error("Profile store scope mismatch.");
    const get = this.db.prepare("SELECT json FROM posts WHERE target_user_id = ? AND tweet_id = ?");
    const upsert = this.db.prepare(
      "INSERT INTO posts (target_user_id, tweet_id, json) VALUES (?, ?, ?)"
      + " ON CONFLICT(target_user_id, tweet_id) DO UPDATE SET json = excluded.json",
    );
    this.db.exec("BEGIN");
    try {
      for (const item of items) {
        const existingRow = get.get(targetUserId, item.tweet_id) as { json: string } | undefined;
        const existing = existingRow
          ? Schema.decodeUnknownSync(BookmarkSchema)(JSON.parse(existingRow.json))
          : undefined;
        const merged = mergeBookmark(existing, item);
        upsert.run(targetUserId, item.tweet_id, JSON.stringify(merged));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async allKnown(items: Bookmark[], targetUserId: string): Promise<boolean> {
    if (targetUserId !== this.targetUserId) throw new Error("Profile store scope mismatch.");
    if (items.length === 0) return false;
    const placeholders = items.map(() => "?").join(",");
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count FROM posts WHERE target_user_id = ? AND tweet_id IN (${placeholders})`,
    ).get(targetUserId, ...items.map((item) => item.tweet_id)) as { count: number | bigint };
    return Number(row.count) === items.length;
  }

  async loadState(targetUserId: string): Promise<ProfileScanState | null> {
    if (targetUserId !== this.targetUserId) return null;
    const row = this.db.prepare("SELECT json FROM state WHERE target_user_id = ?").get(targetUserId) as
      | { json: string }
      | undefined;
    if (!row) return null;
    try {
      return Schema.decodeUnknownSync(ProfileScanStateSchema)(JSON.parse(row.json));
    } catch {
      return null;
    }
  }

  async saveState(targetUserId: string, state: ProfileScanState): Promise<void> {
    if (targetUserId !== this.targetUserId) throw new Error("Profile store scope mismatch.");
    const decoded = Schema.decodeUnknownSync(ProfileScanStateSchema)(state);
    this.db.prepare(
      "INSERT INTO state (target_user_id, json) VALUES (?, ?)"
      + " ON CONFLICT(target_user_id) DO UPDATE SET json = excluded.json",
    ).run(targetUserId, JSON.stringify(decoded));
  }

  async allRecords(): Promise<unknown[]> {
    const rows = this.db.prepare("SELECT json FROM posts WHERE target_user_id = ?").all(this.targetUserId) as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as unknown);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM posts WHERE target_user_id = ?")
      .get(this.targetUserId) as { count: number | bigint };
    return Number(row.count);
  }
}
