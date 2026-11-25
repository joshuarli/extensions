import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface ArchiveFs {
  mkdir(path: string): void;
  readText(path: string): string | null;
  readBytes(path: string): Uint8Array | null;
  size(path: string): number | null;
  writeText(path: string, text: string): void;
  writeAtomicText(path: string, text: string): void;
  writeAtomicBytes(path: string, bytes: Uint8Array): void;
  appendText(path: string, text: string): void;
  listDirs(path: string): readonly string[];
  listFiles(path: string): readonly string[];
  rename(from: string, to: string): void;
  exists(path: string): boolean;
  remove(path: string): void;
}

function enoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function atomicWriteBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const part = path + ".part";
  try {
    writeFileSync(part, bytes, { mode: 0o600 });
    renameSync(part, path);
  } catch (error) {
    try {
      unlinkSync(part);
    } catch (cleanupError) {
      if (!enoent(cleanupError)) throw cleanupError;
    }
    throw error;
  }
}

export function createArchiveFs(): ArchiveFs {
  return {
    mkdir(path) {
      mkdirSync(path, { recursive: true });
    },
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (enoent(error)) return null;
        throw error;
      }
    },
    readBytes(path) {
      try {
        return new Uint8Array(readFileSync(path));
      } catch (error) {
        if (enoent(error)) return null;
        throw error;
      }
    },
    size(path) {
      try {
        return statSync(path).size;
      } catch (error) {
        if (enoent(error)) return null;
        throw error;
      }
    },
    writeText(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, { mode: 0o600 });
    },
    writeAtomicText(path, text) {
      atomicWriteBytes(path, new TextEncoder().encode(text));
    },
    writeAtomicBytes: atomicWriteBytes,
    appendText(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, text, { mode: 0o600 });
    },
    listDirs(path) {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch (error) {
        if (enoent(error)) return [];
        throw error;
      }
    },
    listFiles(path) {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
      } catch (error) {
        if (enoent(error)) return [];
        throw error;
      }
    },
    rename(from, to) {
      if (existsSync(to)) throw new Error("Refusing to overwrite existing media file: " + to);
      renameSync(from, to);
    },
    exists: existsSync,
    remove(path) {
      try {
        unlinkSync(path);
      } catch (error) {
        if (!enoent(error)) throw error;
      }
    },
  };
}
