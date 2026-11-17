import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function stateRoot(): string {
  const base = process.env["X_ARCHIVE_STATE"] ?? process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state");
  return join(base, "x-archive");
}

export function storeDir(accountUserId: string): string {
  return join(stateRoot(), "stores", accountUserId);
}

export function stateDir(accountUserId: string): string {
  return join(stateRoot(), "state", accountUserId);
}

export function credentialsCachePath(): string {
  return join(stateRoot(), "credentials.json");
}

export function downloadsRoot(): string {
  if (process.env["X_ARCHIVE_DOWNLOADS"]) return process.env["X_ARCHIVE_DOWNLOADS"];
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "x", "downloads");
}

export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function writeJsonFile(path: string, value: unknown, mode: number = 0o600): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode });
  renameSync(temporary, path);
}

export function readRawFile(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
