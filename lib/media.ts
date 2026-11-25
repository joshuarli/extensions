export const DEFAULT_MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const MEDIA_SIZE_UNITS: Readonly<Record<string, number>> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 * 1024,
  mb: 1024 * 1024,
  g: 1024 * 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

export function parseMediaSize(value: string): number {
  const match = /^(\d+)(b|k|kb|m|mb|g|gb)?$/iu.exec(value);
  if (!match) {
    throw new Error(
      "--max-media-size must be a non-negative integer with an optional B/KB/MB/GB suffix, got \"" + value + "\".",
    );
  }
  const bytes = Number(match[1]) * (MEDIA_SIZE_UNITS[match[2]?.toLowerCase() ?? "b"] ?? 1);
  if (!Number.isSafeInteger(bytes)) {
    throw new Error("--max-media-size is too large, got \"" + value + "\".");
  }
  return bytes;
}

export function formatMediaSize(bytes: number): string {
  if (bytes === 0) return "unlimited";
  if (bytes % (1024 * 1024) === 0) return bytes / (1024 * 1024) + " MB";
  if (bytes % 1024 === 0) return bytes / 1024 + " KB";
  return bytes + " B";
}

export function isErrorContentType(contentType: string): boolean {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  return type.startsWith("text/") || type === "application/json" || type === "application/xml";
}

export function mediaErrorBody(bytes: Uint8Array): string | null {
  const preview = new TextDecoder().decode(bytes.slice(0, 2048));
  let value: unknown;
  try {
    value = JSON.parse(preview);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (object["status"] !== "error" ||
      (typeof object["error_code"] !== "string" && typeof object["error_type"] !== "string")) {
    return null;
  }
  return preview.slice(0, 200);
}
