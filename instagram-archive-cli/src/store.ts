import {
  emptyCollection,
  withMembership,
  type CollectionKind,
  type CollectionState,
  type Post,
} from "../../instagram-archive-core/src/index.ts";
import { decodeCollection, encodeCollection } from "../../instagram-archive-core/src/index.ts";
import type { ArchiveFs } from "./fs.ts";

export function accountDir(outRoot: string, accountId: string): string {
  const safe = accountId.replace(/[^A-Za-z0-9_-]+/gu, "_").slice(0, 80);
  return outRoot + "/ig-" + safe;
}

export function collectionKey(target: string, saved: boolean): { key: string; kind: CollectionKind; username: string | null } {
  const username = target.startsWith("@") ? target.slice(1) : target;
  if (saved) return { key: (username === "" ? "account" : username) + "-saved", kind: "saved", username: null };
  if (username === "") throw new Error("A profile target is required; use @username.");
  return { key: username, kind: "profile", username };
}

export function collectionDir(accountRoot: string, key: string): string {
  return accountRoot + "/collections/" + key;
}

export function statePath(dir: string): string {
  return dir + "/state.json";
}

export function recordsPath(dir: string): string {
  return dir + "/records.jsonl";
}

export function readState(fs: ArchiveFs, dir: string, kind: CollectionKind, key: string): CollectionState {
  const raw = fs.readText(statePath(dir));
  if (raw === null) return emptyCollection(kind, key);
  const state = decodeCollection(raw);
  if (state === null || state.key !== key || state.kind !== kind) {
    throw new Error("The collection state at " + statePath(dir) + " is unreadable or belongs to another collection.");
  }
  return state;
}

export function writeState(fs: ArchiveFs, dir: string, state: CollectionState): void {
  fs.mkdir(dir);
  fs.writeAtomicText(statePath(dir), encodeCollection(state));
}

export function readPosts(fs: ArchiveFs, dir: string): Post[] {
  const raw = fs.readText(recordsPath(dir));
  if (raw === null) return [];
  const posts: Post[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("The records file at " + recordsPath(dir) + " contains an unreadable line.");
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The records file at " + recordsPath(dir) + " contains an invalid record.");
    }
    const record = value as Record<string, unknown>;
    if (typeof record["shortcode"] !== "string" || !Array.isArray(record["media"])) {
      throw new Error("The records file at " + recordsPath(dir) + " contains an invalid record.");
    }
    posts.push(value as Post);
  }
  return posts;
}

export function appendPosts(fs: ArchiveFs, dir: string, posts: readonly Post[]): void {
  if (posts.length === 0) return;
  fs.mkdir(dir);
  const lines = posts.map((post) => JSON.stringify(post) + "\n").join("");
  fs.appendText(recordsPath(dir), lines);
}

export function markMembership(state: CollectionState, posts: readonly Post[], now: string): CollectionState {
  return withMembership(state, posts.map((post) => ({
    shortcode: post.shortcode,
    username: post.username,
    postType: post.postType,
    capturedAt: now,
    complete: false,
  })));
}
