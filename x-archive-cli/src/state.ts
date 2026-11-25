import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
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

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function ownsLock(value: unknown, token: string): boolean {
  return typeof value === "object" && value !== null && "token" in value && value.token === token;
}

function readLockOwner(lock: string): unknown {
  try {
    return JSON.parse(readFileSync(lock, "utf8")) as unknown;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function withStoreLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lock = path + ".lock";
  mkdirSync(dirname(lock), { recursive: true });
  const token = randomUUID();
  const staleAfterMs = 30_000;
  const deadline = Date.now() + staleAfterMs + 15_000;
  for (;;) {
    try {
      const descriptor = openSync(lock, "wx", 0o600);
      try {
        writeSync(descriptor, JSON.stringify({ pid: process.pid, token }));
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      break;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      let stale = false;
      try {
        stale = Date.now() - statSync(lock).mtimeMs > staleAfterMs;
      } catch (statError) {
        if (!hasErrorCode(statError, "ENOENT")) throw statError;
      }
      if (stale) {
        const abandoned = `${lock}.abandoned.${token}`;
        try {
          renameSync(lock, abandoned);
          rmSync(abandoned, { force: true });
        } catch (renameError) {
          if (!hasErrorCode(renameError, "ENOENT")) throw renameError;
        }
      } else if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the archive lock at " + lock + ".");
      } else {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
    }
  }
  try {
    return await work();
  } finally {
    try {
      if (ownsLock(readLockOwner(lock), token)) unlinkSync(lock);
    } catch (error) {
      console.warn("Could not release archive lock " + lock, error);
    }
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
