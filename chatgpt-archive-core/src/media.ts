import type { MediaJob } from "./types.ts";

const FILE_SERVICE_PREFIX = "file-service://";
const POINTER_ID_KEYS = ["file_id", "id", "asset_pointer", "fileId"] as const;
const FILENAME_KEYS = ["file_name", "filename"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function sanitizeMediaFilename(id: string, name?: string): string {
  const source = name !== undefined && name.trim() !== "" ? name : id;
  const cleaned = source
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  const base = cleaned === "" || cleaned === "." || cleaned === ".." ? "media" : cleaned;
  return `${base}-${hash32(id)}.bin`;
}

function pointerId(value: Record<string, unknown>): string | null {
  for (const key of POINTER_ID_KEYS) {
    const candidate = value[key];
    if (typeof candidate !== "string") continue;
    const id = candidate.startsWith(FILE_SERVICE_PREFIX)
      ? candidate.slice(FILE_SERVICE_PREFIX.length).trim()
      : candidate.trim();
    if (id !== "") return id;
  }
  return null;
}

function pointerName(value: Record<string, unknown>): string | undefined {
  for (const key of FILENAME_KEYS) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}

function remember(value: string, found: Map<string, string | undefined>, name?: string): void {
  const id = value.startsWith(FILE_SERVICE_PREFIX) ? value.slice(FILE_SERVICE_PREFIX.length).trim() : value.trim();
  if (id === "") return;
  if (found.has(id)) {
    if (name !== undefined && found.get(id) === undefined) found.set(id, name);
    return;
  }
  found.set(id, name);
}

function visit(value: unknown, key: string | null, found: Map<string, string | undefined>): void {
  if (typeof value === "string") {
    if (key === "library_file_id" || value.startsWith(FILE_SERVICE_PREFIX)) remember(value, found);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, null, found);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "asset_pointer" && isRecord(child)) {
      const id = pointerId(child);
      if (id !== null) remember(id, found, pointerName(child));
    }
    visit(child, childKey, found);
  }
}

export function extractMediaJobs(record: unknown): MediaJob[] {
  const found = new Map<string, string | undefined>();
  visit(record, null, found);
  return Array.from(found.entries())
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, name]) => ({
      id,
      filename: sanitizeMediaFilename(id, name),
      path: `/backend-api/files/${encodeURIComponent(id)}/download`,
    }));
}
