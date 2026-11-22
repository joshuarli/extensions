import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export interface ArchiveFs {
  mkdir(path: string): void;
  readText(path: string): string | null;
  appendText(path: string, text: string): void;
  writeText(path: string, text: string): void;
  exists(path: string): boolean;
  writeBytes(path: string, bytes: Uint8Array): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
}

export function createNodeArchiveFs(): ArchiveFs {
  return {
    mkdir(path) {
      mkdirSync(path, { recursive: true });
    },
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    appendText(path, text) {
      appendFileSync(path, text, { mode: 0o600 });
    },
    writeText(path, text) {
      writeFileSync(path, text, { mode: 0o600 });
    },
    exists(path) {
      return existsSync(path);
    },
    writeBytes(path, bytes) {
      writeFileSync(path, bytes, { mode: 0o600 });
    },
    rename(from, to) {
      try {
        linkSync(from, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("Refusing to overwrite existing media file: " + to);
        }
        throw error;
      }
      unlinkSync(from);
    },
    remove(path) {
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.filter((line) => line.length > 0);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
