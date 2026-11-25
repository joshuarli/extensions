import { homedir } from "node:os";
import { join } from "node:path";
import {
  decodeArchiveState,
  emptyArchiveState,
  encodeArchiveState,
  type ArchiveState,
  type ChatgptArchive,
} from "../../chatgpt-archive-core/src/index.ts";
import { splitLines, type ArchiveFs } from "./storage.ts";

const LEGACY_FOLDER = /^chatgpt-\d{4}-\d{2}-\d{2}$/;

export function downloadsRoot(): string {
  const configured = process.env["CHATGPT_ARCHIVE_DOWNLOADS"];
  if (configured) return configured;
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "chatgpt-archive", "downloads");
}

export function archiveDir(outRoot: string, accountId: string): string {
  const safeId = accountId.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
  return join(outRoot, "chatgpt-" + safeId);
}

export function knownAccountIds(fs: ArchiveFs, outRoot: string): string[] {
  const ids = new Set<string>();
  for (const name of fs.listDirs(outRoot)) {
    if (LEGACY_FOLDER.test(name) || !name.startsWith("chatgpt-")) continue;
    const path = join(outRoot, name, "manifest.json");
    const raw = fs.readText(path);
    if (raw === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("The archive manifest at " + path + " is unreadable.");
    }
    if (value === null || typeof value !== "object") {
      throw new Error("The archive manifest at " + path + " is unreadable.");
    }
    const accountId = (value as Record<string, unknown>)["accountId"];
    if (typeof accountId === "string" && accountId !== "") ids.add(accountId);
  }
  return [...ids];
}

export function readRecordLines(
  fs: ArchiveFs,
  path: string,
  archive: ChatgptArchive,
): Map<string, string> {
  const byId = new Map<string, string>();
  for (const line of splitLines(fs.readText(path) ?? "")) {
    const record = archive.decodeRecordLine(line);
    if (record !== null) byId.set(record.id, line);
  }
  return byId;
}

function importLegacyRecords(fs: ArchiveFs, outRoot: string, recordsPath: string, archive: ChatgptArchive): void {
  const saved = readRecordLines(fs, recordsPath, archive);
  for (const name of fs.listDirs(outRoot)) {
    if (!LEGACY_FOLDER.test(name)) continue;
    const legacy = readRecordLines(fs, join(outRoot, name, "records.jsonl"), archive);
    for (const [id, line] of legacy) {
      if (saved.has(id)) continue;
      fs.appendText(recordsPath, line + "\n");
      saved.set(id, line);
    }
  }
}

export function readArchiveState(
  fs: ArchiveFs,
  outRoot: string,
  outputDir: string,
  accountId: string,
  archive: ChatgptArchive,
): ArchiveState {
  const path = join(outputDir, "state.json");
  const raw = fs.readText(path);
  if (raw === null) {
    importLegacyRecords(fs, outRoot, join(outputDir, "records.jsonl"), archive);
    return emptyArchiveState(accountId);
  }
  const state = decodeArchiveState(raw);
  if (state === null || state.accountId !== accountId) {
    throw new Error("The archive state at " + path + " is unreadable or belongs to another account.");
  }
  return state;
}

export function writeArchiveState(fs: ArchiveFs, outputDir: string, state: ArchiveState): void {
  fs.writeAtomicText(join(outputDir, "state.json"), encodeArchiveState(state));
}
