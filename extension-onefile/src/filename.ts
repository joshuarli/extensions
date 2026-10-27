const illegalNamePattern = /[<>:"/\\|?*\u0000-\u001f]/g,
  trailingDotsSpaces = /[. ]+$/u,
  maxBaseLength = 180;

export function sanitizeTitleForFilename(title: string): string {
  const cleaned = title.replace(illegalNamePattern, "").replace(/\s+/g, " ").trim().replace(trailingDotsSpaces, "");
  if (cleaned === "") return "Untitled page";
  return cleaned.length > maxBaseLength ? cleaned.slice(0, maxBaseLength).trimEnd() : cleaned;
}

export function formatSaveTimestamp(now: Date): string {
  const part = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${now.getFullYear()}-${part(now.getMonth() + 1, 2)}-${part(now.getDate(), 2)} ${part(now.getHours(), 2)}-${part(now.getMinutes(), 2)}-${part(now.getSeconds(), 2)}`;
}

export function buildArchiveFilename(title: string, now: Date): string {
  return `${sanitizeTitleForFilename(title)} (${formatSaveTimestamp(now)}).u.zip.html`;
}

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/bmp": "bmp",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "text/css": "css",
};

export function resourceEntryName(index: number, url: string, mime: string): string {
  const fromMime = mimeExtensions[mime.toLowerCase()];
  if (fromMime) return `resources/${index}.${fromMime}`;
  const fromPath = (() => {
    try {
      const tail = new URL(url).pathname.split("/").pop() ?? "",
        dot = tail.lastIndexOf(".");
      if (dot < 0) return null;
      const extension = tail.slice(dot + 1).toLowerCase();
      return /^[a-z0-9]{1,8}$/u.test(extension) ? extension : null;
    } catch {
      return null;
    }
  })();
  return `resources/${index}.${fromPath ?? "bin"}`;
}
