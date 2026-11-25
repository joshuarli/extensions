import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Schema } from "effect";
import { DiscoveredPostSchema, type DiscoveredPost } from "./post.ts";

export interface AppendResult {
  written: number;
  duplicates: number;
}

export function readPosts(path: string): DiscoveredPost[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    if (line.trim() === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("Corrupt discovery post at line " + (index + 1) + " of " + path + ".");
    }
    try {
      return [Schema.decodeUnknownSync(DiscoveredPostSchema)(parsed)];
    } catch (error) {
      throw new Error("Invalid discovery post at line " + (index + 1) + " of " + path + ": "
        + (error instanceof Error ? error.message : String(error)));
    }
  });
}

export function appendNewPosts(path: string, posts: readonly DiscoveredPost[]): AppendResult {
  const known = new Set(readPosts(path).map((post) => post.tweet_id));
  const fresh = posts.filter((post) => {
    if (known.has(post.tweet_id)) return false;
    known.add(post.tweet_id);
    return true;
  });
  if (fresh.length > 0) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, fresh.map((post) => JSON.stringify(post)).join("\n") + "\n", { mode: 0o600 });
  }
  return { written: fresh.length, duplicates: posts.length - fresh.length };
}

export function readCursor(path: string): string | null {
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed === "string") return parsed;
  throw new Error("Invalid discovery cursor file at " + path + ".");
}

export function writeCursor(path: string, cursor: string | null): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(cursor) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}
