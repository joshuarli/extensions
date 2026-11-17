import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { BookmarkSchema, type Bookmark } from "../../x-archive-core/src/parser.ts";
import { mergeBookmark } from "../../x-archive-core/src/merge.ts";
import {
  ScanStateSchema,
  LikesScanStateSchema,
  type ScanState,
  type LikesScanState,
} from "../../x-archive-core/src/storage.ts";
import type {
  BookmarksStore,
  LikesStore,
} from "../../x-archive-core/src/collector.ts";
import { storeDir, stateDir, readJsonFile, writeJsonFile } from "./state.ts";

function readRecords(path: string): unknown[] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`Cannot parse archive ${path}`, { cause: error });
  }
  if (!Array.isArray(value)) throw new TypeError(`Archive ${path} must contain a JSON array`);
  return value;
}

function writeRecords(path: string, records: unknown[]): void {
  writeJsonFile(path, records);
}

function readState<T>(path: string, decode: (value: unknown) => T | null): T | null {
  return decode(readJsonFile(path));
}

export class FsBookmarksStore implements BookmarksStore {
  private readonly itemsPath: string;
  private readonly statePath: string;
  private readonly foldersPath: string;

  constructor(userId: string) {
    this.itemsPath = join(storeDir(userId), "bookmarks.json");
    this.statePath = join(stateDir(userId), "bookmarks-state.json");
    this.foldersPath = join(storeDir(userId), "folders.json");
  }

  async savePage(items: Bookmark[], folderId?: string): Promise<void> {
    if (items.length === 0) return;
    const records = readRecords(this.itemsPath);
    const byId = new Map<string, Bookmark>();
    for (const record of records) {
      const parsed = Schema.decodeUnknownSync(BookmarkSchema)(record);
      byId.set(parsed.tweet_id, parsed);
    }
    for (const item of items) {
      byId.set(item.tweet_id, mergeBookmark(byId.get(item.tweet_id), item, folderId));
    }
    writeRecords(this.itemsPath, [...byId.values()]);
  }

  async saveFolders(folders: ReadonlyArray<{ id: string; name: string }>): Promise<void> {
    const existing = new Map<string, { id: string; name: string }>();
    for (const record of readRecords(this.foldersPath)) {
      if (typeof (record as { id?: unknown }).id === "string") existing.set((record as { id: string }).id, record as { id: string; name: string });
    }
    for (const folder of folders) existing.set(folder.id, folder);
    writeJsonFile(this.foldersPath, [...existing.values()]);
  }

  async loadState(): Promise<ScanState | null> {
    return readState(this.statePath, (value) => {
      try {
        return Schema.decodeUnknownSync(ScanStateSchema)(value);
      } catch {
        return null;
      }
    });
  }

  async saveState(state: ScanState): Promise<void> {
    writeJsonFile(this.statePath, Schema.decodeUnknownSync(ScanStateSchema)(state));
  }

  async allRecords(): Promise<unknown[]> {
    return readRecords(this.itemsPath);
  }

  async allFolders(): Promise<unknown[]> {
    return readRecords(this.foldersPath);
  }
}

export class FsLikesStore implements LikesStore {
  private readonly itemsPath: string;
  private readonly statePath: string;

  constructor(userId: string) {
    this.itemsPath = join(storeDir(userId), "likes.json");
    this.statePath = join(stateDir(userId), "likes-state.json");
  }

  async savePage(items: Bookmark[]): Promise<void> {
    if (items.length === 0) return;
    const records = readRecords(this.itemsPath);
    const byId = new Map<string, Bookmark>();
    for (const record of records) {
      const parsed = Schema.decodeUnknownSync(BookmarkSchema)(record);
      byId.set(parsed.tweet_id, parsed);
    }
    for (const item of items) {
      byId.set(item.tweet_id, mergeBookmark(byId.get(item.tweet_id), item));
    }
    writeRecords(this.itemsPath, [...byId.values()]);
  }

  async loadState(): Promise<LikesScanState | null> {
    return readState(this.statePath, (value) => {
      try {
        return Schema.decodeUnknownSync(LikesScanStateSchema)(value);
      } catch {
        return null;
      }
    });
  }

  async saveState(state: LikesScanState): Promise<void> {
    writeJsonFile(this.statePath, Schema.decodeUnknownSync(LikesScanStateSchema)(state));
  }

  async allRecords(): Promise<unknown[]> {
    return readRecords(this.itemsPath);
  }
}

