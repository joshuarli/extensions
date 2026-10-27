import type { CapturePayload } from "../message-contract.ts";

export const resourceTokenPrefix = "onefile-resource-",
  missingResourceToken = "onefile-missing";

const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)"']*))\s*\)/g,
  fontFacePattern = /@font-face\s*\{[^}]*\}/gi;

export function absolutizeHttpUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

export function splitSrcset(value: string): SrcsetCandidate[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [url = "", ...rest] = part.split(/\s+/);
      return { url, descriptor: rest.join(" ") };
    });
}

export interface CssResource {
  url: string;
  kind: "image" | "font";
}

export function collectCssResources(
  cssText: string,
  base: string,
): { rewritten: string; resources: CssResource[] } {
  const resources: CssResource[] = [],
    fontRanges: [number, number][] = [];
  let rangeMatch: RegExpExecArray | null;
  fontFacePattern.lastIndex = 0;
  while ((rangeMatch = fontFacePattern.exec(cssText)) !== null) {
    fontRanges.push([rangeMatch.index, rangeMatch.index + rangeMatch[0].length]);
  }
  const rewritten = cssText.replace(
    cssUrlPattern,
    (
      match: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      bare: string | undefined,
      offset: number,
    ) => {
      const raw = String(doubleQuoted ?? singleQuoted ?? bare ?? "");
      if (raw.trim() === "" || raw.startsWith("data:")) return match;
      const absolute = absolutizeHttpUrl(raw, base);
      if (!absolute) return match;
      const insideFont = fontRanges.some(([start, end]) => offset >= start && offset < end);
      resources.push({ url: absolute, kind: insideFont ? "font" : "image" });
      return `url("${absolute}")`;
    },
  );
  return { rewritten, resources };
}

export async function captureDocument(
  doc: Document,
  baseUrl: string,
  nowMs: number,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<CapturePayload> {
  const resources: { url: string; kind: "image" | "stylesheet" | "font" }[] = [],
    unresolved: { url: string; reason: string }[] = [],
    seen = new Map<string, string>();
  const take = (url: string, kind: "image" | "font"): string => {
    const existing = seen.get(url);
    if (existing) return existing;
    const token = `${resourceTokenPrefix}${seen.size}`;
    seen.set(url, token);
    resources.push({ url, kind });
    return token;
  };
  const root = doc.documentElement.cloneNode(true) as HTMLElement,
    resolveBase = doc.baseURI || baseUrl;
  root.querySelectorAll("script").forEach((element) => element.remove());
  for (const element of Array.from(root.querySelectorAll("link"))) {
    const rel = (element.getAttribute("rel") ?? "").toLowerCase();
    if (rel !== "stylesheet") {
      element.remove();
      continue;
    }
    const rawHref = element.getAttribute("href") ?? "",
      absoluteHref = absolutizeHttpUrl(rawHref, resolveBase);
    if (!absoluteHref) {
      element.remove();
      if (rawHref.trim() !== "") unresolved.push({ url: rawHref, reason: "unresolvable stylesheet href" });
      continue;
    }
    let cssText: string | null = null;
    try {
      const response = await fetcher(absoluteHref, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) cssText = await response.text();
    } catch {
      cssText = null;
    }
    if (cssText === null) {
      element.remove();
      unresolved.push({ url: absoluteHref, reason: "stylesheet fetch failed" });
      continue;
    }
    const { rewritten, resources: found } = collectCssResources(cssText, absoluteHref),
      replacement = doc.createElement("style");
    replacement.textContent = rewritten;
    replacement.setAttribute("data-onefile-from", absoluteHref);
    element.replaceWith(replacement);
    for (const item of found) take(item.url, item.kind);
  }
  for (const style of Array.from(root.querySelectorAll("style"))) {
    const { rewritten, resources: found } = collectCssResources(style.textContent ?? "", resolveBase);
    style.textContent = rewritten;
    for (const item of found) take(item.url, item.kind);
  }
  root.querySelectorAll("img[src], source[src], video[poster]").forEach((element) => {
    const attribute = element.hasAttribute("src") ? "src" : "poster",
      raw = (element.getAttribute(attribute) ?? "").trim();
    if (raw === "") {
      element.removeAttribute(attribute);
      unresolved.push({ url: "(empty)", reason: "ephemeral source" });
      return;
    }
    if (raw.startsWith("data:")) return;
    const absolute = absolutizeHttpUrl(raw, resolveBase);
    if (!absolute) {
      element.setAttribute(attribute, missingResourceToken);
      unresolved.push({ url: raw, reason: "ephemeral source" });
      return;
    }
    element.setAttribute(attribute, take(absolute, "image"));
  });
  root.querySelectorAll("img[srcset], source[srcset]").forEach((element) => {
    const raw = element.getAttribute("srcset") ?? "",
      rewritten = splitSrcset(raw)
        .map((candidate) => {
          if (candidate.url.startsWith("data:")) return candidate;
          const absolute = absolutizeHttpUrl(candidate.url, resolveBase);
          if (!absolute) return null;
          return { url: take(absolute, "image"), descriptor: candidate.descriptor };
        })
        .filter((candidate) => candidate !== null);
    if (rewritten.length === 0) {
      element.removeAttribute("srcset");
      unresolved.push({ url: raw, reason: "unresolvable srcset" });
    } else {
      element.setAttribute(
        "srcset",
        rewritten
          .map((candidate) => `${candidate.url}${candidate.descriptor ? ` ${candidate.descriptor}` : ""}`)
          .join(", "),
      );
    }
  });
  root
    .querySelectorAll("video[src], audio[src], embed[src], object[data], source[src]:not([srcset])")
    .forEach((element) => {
      const attribute = element.hasAttribute("data") ? "data" : "src",
        raw = element.getAttribute(attribute) ?? "";
      element.removeAttribute(attribute);
      if (raw.trim() !== "") unresolved.push({ url: raw, reason: "media capture is out of scope" });
    });
  root.querySelectorAll("iframe[src]").forEach((element) => {
    const raw = element.getAttribute("src") ?? "";
    element.removeAttribute("src");
    if (raw.trim() !== "") unresolved.push({ url: raw, reason: "frame capture lands in OF-03" });
  });
  root.querySelectorAll("[style]").forEach((element) => {
    const { rewritten, resources: found } = collectCssResources(
      element.getAttribute("style") ?? "",
      resolveBase,
    );
    element.setAttribute("style", rewritten);
    for (const item of found) take(item.url, item.kind);
  });
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  return {
    pageUrl: baseUrl,
    title: doc.title,
    capturedAtMs: nowMs,
    pageHtml: `${doctype}\n${root.outerHTML}`,
    resources,
    unresolved,
  };
}

globalThis.onefileCapture = (_stamp: string, nowMs: number): Promise<CapturePayload> =>
  captureDocument(document, location.href, nowMs);

declare global {
  var onefileCapture: ((_stamp: string, nowMs: number) => Promise<CapturePayload>) | undefined;
}
