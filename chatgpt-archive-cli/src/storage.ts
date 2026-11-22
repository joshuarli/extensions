import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface ArchiveFs {
  mkdir(path: string): void;
  readText(path: string): string | null;
  appendText(path: string, text: string): void;
  writeText(path: string, text: string): void;
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
