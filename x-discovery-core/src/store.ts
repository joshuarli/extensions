import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import type { PageCommit } from "./collector.ts";
import type { Feed, FeedObservation, ObservationRun } from "./observation.ts";
import { DiscoveredPostSchema, type DiscoveredPost } from "./post.ts";

export function contentHash(post: DiscoveredPost): string {
  const normalized = JSON.stringify([
    post.author_id,
    post.full_text,
    post.urls.map((link) => link.url),
    post.relationship?.kind ?? "original",
  ]);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export interface CommitPageInput extends PageCommit {
  runId: string;
  accountId: string;
  feed: Feed;
}

export class DiscoveryStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS runs ("
      + "  run_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, feed TEXT NOT NULL,"
      + "  started_at TEXT NOT NULL, ended_at TEXT, stop_reason TEXT, budget_pages INTEGER NOT NULL"
      + ");"
      + "CREATE TABLE IF NOT EXISTS posts ("
      + "  tweet_id TEXT NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL, observed_at TEXT NOT NULL,"
      + "  PRIMARY KEY (tweet_id, hash)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS observations ("
      + "  run_id TEXT NOT NULL, entry_id TEXT NOT NULL, position INTEGER NOT NULL,"
      + "  tweet_id TEXT, author_id TEXT, author_handle TEXT, relationship TEXT NOT NULL, observed_at TEXT NOT NULL,"
      + "  PRIMARY KEY (run_id, entry_id)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS checkpoints ("
      + "  run_id TEXT PRIMARY KEY, cursor TEXT"
      + ");"
      + "CREATE TABLE IF NOT EXISTS raw_pages ("
      + "  run_id TEXT NOT NULL, page INTEGER NOT NULL, json TEXT NOT NULL,"
      + "  PRIMARY KEY (run_id, page)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS page_accounting ("
      + "  run_id TEXT NOT NULL, page INTEGER NOT NULL, json TEXT NOT NULL,"
      + "  PRIMARY KEY (run_id, page)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS page_failures ("
      + "  run_id TEXT NOT NULL, page INTEGER NOT NULL, detail TEXT NOT NULL, json TEXT NOT NULL,"
      + "  PRIMARY KEY (run_id, page)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS derivations ("
      + "  input_hash TEXT NOT NULL, version TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL,"
      + "  PRIMARY KEY (input_hash, version)"
      + ");"
      + "CREATE TABLE IF NOT EXISTS job_locks ("
      + "  account_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, acquired_at TEXT NOT NULL"
      + ");",
    );
  }

  acquireJobLock(accountId: string, runId: string, at: string = new Date().toISOString()): boolean {
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO job_locks (account_id, run_id, acquired_at) VALUES (?, ?, ?)",
    ).run(accountId, runId, at);
    return result.changes === 1;
  }

  releaseJobLock(accountId: string, runId: string): void {
    this.db.prepare("DELETE FROM job_locks WHERE account_id = ? AND run_id = ?").run(accountId, runId);
  }

  beginRun(run: ObservationRun): void {
    this.db.prepare(
      "INSERT INTO runs (run_id, account_id, feed, started_at, ended_at, stop_reason, budget_pages)"
      + " VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(run.runId, run.accountId, run.feed, run.startedAt, run.endedAt, run.stopReason, run.budgetPages);
    this.db.prepare("INSERT OR IGNORE INTO checkpoints (run_id, cursor) VALUES (?, NULL)").run(run.runId);
  }

  finishRun(runId: string, stopReason: string, at: string = new Date().toISOString()): void {
    this.db.prepare("UPDATE runs SET ended_at = ?, stop_reason = ? WHERE run_id = ?").run(at, stopReason, runId);
  }

  commitPage(input: CommitPageInput): void {
    const insertPost = this.db.prepare(
      "INSERT OR IGNORE INTO posts (tweet_id, hash, json, observed_at) VALUES (?, ?, ?, ?)",
    );
    const insertObservation = this.db.prepare(
      "INSERT OR IGNORE INTO observations (run_id, entry_id, position, tweet_id, author_id, author_handle, relationship, observed_at)"
      + " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT OR REPLACE INTO raw_pages (run_id, page, json) VALUES (?, ?, ?)")
        .run(input.runId, input.page, JSON.stringify(input.data));
      this.db.prepare("INSERT OR REPLACE INTO page_accounting (run_id, page, json) VALUES (?, ?, ?)")
        .run(input.runId, input.page, JSON.stringify(input.accounting));
      input.posts.forEach((post, index) => {
        insertPost.run(post.tweet_id, contentHash(post), JSON.stringify(post), post.observed_at);
        insertObservation.run(
          input.runId,
          "tweet-" + post.tweet_id,
          index,
          post.tweet_id,
          post.author_id,
          post.author_handle,
          post.relationship?.kind ?? "original",
          post.observed_at,
        );
      });
      this.db.prepare("UPDATE checkpoints SET cursor = ? WHERE run_id = ?").run(input.cursor, input.runId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveFailure(runId: string, page: number, data: unknown, detail: string): void {
    this.db.prepare("INSERT OR REPLACE INTO raw_pages (run_id, page, json) VALUES (?, ?, ?)")
      .run(runId, page, JSON.stringify(data));
    this.db.prepare("INSERT OR REPLACE INTO page_failures (run_id, page, detail, json) VALUES (?, ?, ?, ?)")
      .run(runId, page, detail, JSON.stringify(data));
  }

  failures(runId: string): Array<{ page: number; detail: string }> {
    const rows = this.db.prepare("SELECT page, detail FROM page_failures WHERE run_id = ? ORDER BY page")
      .all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ page: Number(row["page"]), detail: String(row["detail"]) }));
  }

  readCheckpoint(runId: string): string | null {
    const row = this.db.prepare("SELECT cursor FROM checkpoints WHERE run_id = ?").get(runId) as
      | { cursor: string | null } | undefined;
    return row?.cursor ?? null;
  }

  allPosts(): DiscoveredPost[] {
    const rows = this.db.prepare("SELECT json FROM posts ORDER BY observed_at DESC").all() as Array<{ json: string }>;
    const seen = new Set<string>();
    const posts: DiscoveredPost[] = [];
    for (const row of rows) {
      const parsed: unknown = JSON.parse(row.json);
      const post = Schema.decodeUnknownSync(DiscoveredPostSchema)(parsed);
      if (seen.has(post.tweet_id)) continue;
      seen.add(post.tweet_id);
      posts.push(post);
    }
    return posts;
  }

  observations(runId: string): FeedObservation[] {
    const rows = this.db.prepare(
      "SELECT run_id, entry_id, position, tweet_id, author_id, author_handle, relationship, observed_at"
      + " FROM observations WHERE run_id = ? ORDER BY position",
    ).all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      runId: String(row["run_id"]),
      entryId: String(row["entry_id"]),
      position: Number(row["position"]),
      tweetId: row["tweet_id"] === null ? null : String(row["tweet_id"]),
      authorId: row["author_id"] === null ? null : String(row["author_id"]),
      authorHandle: row["author_handle"] === null ? null : String(row["author_handle"]),
      relationship: String(row["relationship"]),
      observedAt: String(row["observed_at"]),
    }));
  }

  runs(accountId?: string): ObservationRun[] {
    const rows = accountId === undefined
      ? this.db.prepare("SELECT * FROM runs ORDER BY started_at DESC").all()
      : this.db.prepare("SELECT * FROM runs WHERE account_id = ? ORDER BY started_at DESC").all(accountId);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      runId: String(row["run_id"]),
      accountId: String(row["account_id"]),
      feed: String(row["feed"]) as Feed,
      startedAt: String(row["started_at"]),
      endedAt: row["ended_at"] === null || row["ended_at"] === undefined ? null : String(row["ended_at"]),
      stopReason: row["stop_reason"] === null || row["stop_reason"] === undefined ? null : String(row["stop_reason"]),
      budgetPages: Number(row["budget_pages"]),
    }));
  }

  accounting(runId: string, page: number): unknown {
    const row = this.db.prepare("SELECT json FROM page_accounting WHERE run_id = ? AND page = ?")
      .get(runId, page) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  rawPage(runId: string, page: number): unknown {
    const row = this.db.prepare("SELECT json FROM raw_pages WHERE run_id = ? AND page = ?")
      .get(runId, page) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  saveDerivation(inputHash: string, version: string, result: unknown, at: string = new Date().toISOString()): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO derivations (input_hash, version, json, created_at) VALUES (?, ?, ?, ?)",
    ).run(inputHash, version, JSON.stringify(result), at);
  }

  derivation(inputHash: string, version: string): unknown {
    const row = this.db.prepare(
      "SELECT json FROM derivations WHERE input_hash = ? AND version = ?",
    ).get(inputHash, version) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  close(): void {
    this.db.close();
  }
}
