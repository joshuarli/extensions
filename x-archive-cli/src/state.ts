import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
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

export async function withStoreLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = path + ".lock";
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() >= deadline) throw new Error("Timed out waiting for the archive lock at " + lock + ".");
      else await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
  try {
    return await work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
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
  const temporary = `${path}.tmp.${process.pid}`;
  const descriptor = openSync(temporary, "w", mode);
  try {
    writeSync(descriptor, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      console.warn("Could not remove staging file " + temporary, cleanupError);
    }
    throw error;
  }
}

export function readRawFile(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
