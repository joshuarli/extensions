import { extractStoredEntry, readStoredArchive } from "../zip.ts";

const metadataElementId = "onefile-metadata",
  bannerElementId = "onefile-banner",
  metadataName = "metadata.json",
  resourcePrefix = "resources/",
  missingToken = "onefile-missing",
  placeholderImage =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23dddddd'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='14' fill='%23666666'%3Eimage not in archive%3C/text%3E%3C/svg%3E";

interface ArchiveIndex {
  sourceUrl: string;
  capturedAtMs: number;
  unresolvedTotal: number;
  unresolvedSample: { url: string; reason: string }[];
  entries: { name: string; mime: string }[];
}

function readEmbeddedIndex(): ArchiveIndex | null {
  const element = document.getElementById(metadataElementId);
  if (!element) return null;
  try {
    const parsed = JSON.parse(element.textContent ?? "") as Partial<ArchiveIndex>;
    if (typeof parsed.sourceUrl !== "string" || typeof parsed.capturedAtMs !== "number") return null;
    return {
      sourceUrl: parsed.sourceUrl,
      capturedAtMs: parsed.capturedAtMs,
      unresolvedTotal: typeof parsed.unresolvedTotal === "number" ? parsed.unresolvedTotal : 0,
      unresolvedSample: Array.isArray(parsed.unresolvedSample) ? parsed.unresolvedSample : [],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return null;
  }
}

function showBanner(lines: string[]): void {
  const banner = document.getElementById(bannerElementId);
  if (!banner) return;
  banner.textContent = "";
  banner.removeAttribute("hidden");
  for (const line of lines) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    banner.appendChild(paragraph);
  }
}

function readOwnBytes(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const probe = new XMLHttpRequest();
    probe.responseType = "arraybuffer";
    probe.timeout = 15_000;
    probe.onerror = () => resolve(null);
    probe.ontimeout = () => resolve(null);
    probe.onreadystatechange = () => {
      if (probe.readyState !== 4) return;
      if (probe.status === 200 && probe.response instanceof ArrayBuffer) {
        resolve(new Uint8Array(probe.response));
      } else {
        resolve(null);
      }
    };
    try {
      probe.open("GET", "", true);
      probe.send();
    } catch {
      resolve(null);
    }
  });
}

function rewriteReference(value: string, byPath: Map<string, string>): string | null {
  if (value === missingToken) return placeholderImage;
  if (!value.startsWith(resourcePrefix)) return null;
  return byPath.get(value) ?? placeholderImage;
}

function upgradeDocument(urls: Map<string, string>): void {
  for (const element of Array.from(document.querySelectorAll("[src]"))) {
    const current = element.getAttribute("src") ?? "",
      next = rewriteReference(current, urls);
    if (next !== null) element.setAttribute("src", next);
  }
  for (const element of Array.from(document.querySelectorAll("[href]"))) {
    const current = element.getAttribute("href") ?? "",
      next = rewriteReference(current, urls);
    if (next !== null) element.setAttribute("href", next);
  }
  for (const element of Array.from(document.querySelectorAll("[srcset]"))) {
    const raw = element.getAttribute("srcset") ?? "";
    element.setAttribute(
      "srcset",
      raw
        .split(",")
        .map((part) => {
          const pieces = part.trim().split(/\s+/),
            first = pieces[0] ?? "";
          if (first === "") return null;
          const next = rewriteReference(first, urls);
          if (next === null) return part.trim();
          return [next, ...pieces.slice(1)].join(" ");
        })
        .filter((part) => part !== null)
        .join(", "),
    );
  }
}

function degradeDocument(index: ArchiveIndex, reason: string): void {
  upgradeDocument(new Map());
  const savedAt = new Date(index.capturedAtMs).toISOString(),
    lines = [
      `Onefile archive of ${index.sourceUrl} saved at ${savedAt}.`,
      reason,
    ];
  if (index.unresolvedTotal > 0) {
    lines.push(`${index.unresolvedTotal} file(s) were already missing at save time.`);
  }
  lines.push("Serve this file over http(s) or unzip it for full fidelity.");
  showBanner(lines);
}

async function main(): Promise<void> {
  const index = readEmbeddedIndex();
  if (!index) {
    showBanner(["Onefile archive index is unreadable."]);
    return;
  }
  const ownBytes = await readOwnBytes();
  if (!ownBytes) {
    degradeDocument(index, "This browser would not hand the archive its own bytes, so images stay placeholders.");
    return;
  }
  try {
    const directory = readStoredArchive(ownBytes),
      metadataBytes = extractStoredEntry(directory, metadataName),
      metadataText = new TextDecoder().decode(metadataBytes),
      urls = new Map<string, string>();
    void metadataText;
    for (const entry of directory.entries) {
      if (entry.name === metadataName || !entry.name.startsWith(resourcePrefix)) continue;
      const found = index.entries.find((candidate) => candidate.name === entry.name),
        data = extractStoredEntry(directory, entry.name);
      urls.set(entry.name, URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: found?.mime ?? "application/octet-stream" })));
    }
    upgradeDocument(urls);
  } catch {
    degradeDocument(index, "The embedded archive failed its integrity check.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void main());
} else {
  void main();
}
