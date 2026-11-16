import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
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

export function profileStoreDir(accountUserId: string, targetUserId: string): string {
  return join(stateRoot(), "stores", accountUserId, "profile", targetUserId);
}

export function profileStateDir(accountUserId: string, targetUserId: string): string {
  return join(stateRoot(), "state", accountUserId, "profile", targetUserId);
}

export function credentialsCachePath(): string {
  return join(stateRoot(), "credentials.json");
}

export function downloadsRoot(): string {
  return join(homedir(), "Downloads");
}

export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null;
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
