import type { CapturePayload } from "../message-contract.ts";
import { capturePolicy } from "../policy.ts";

export const resourceTokenPrefix = "onefile-resource-",
  missingResourceToken = "onefile-missing";

const maxFrameDepth = 3;

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

const cssImportPattern = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)"']*))\s*\)|(?:"([^"]*)"|'([^']*)'))[^;]*;/g,
  maxImportDepth = 2;

export async function resolveCssImports(
  cssText: string,
  base: string,
  fetcher: typeof fetch,
  depth = 0,
): Promise<{ text: string; failed: string[] }> {
  const failed: string[] = [];
  if (depth > maxImportDepth) return { text: cssText, failed };
  let text = cssText,
    match: RegExpExecArray | null;
  cssImportPattern.lastIndex = 0;
  const imports: string[] = [];
  while ((match = cssImportPattern.exec(cssText)) !== null) {
    imports.push(match[0]);
  }
  for (const statement of imports) {
    const urlMatch = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)"']*))\s*\)/.exec(statement) ??
      /@import\s+(?:"([^"]*)"|'([^']*)')/.exec(statement),
      raw = urlMatch?.[1] ?? urlMatch?.[2] ?? urlMatch?.[3] ?? "",
      absolute = absolutizeHttpUrl(raw, base);
    if (!absolute) {
      text = text.replace(statement, () => "");
      if (raw.trim() !== "") failed.push(raw);
      continue;
    }
    let imported: string | null = null;
    try {
      const response = await fetcher(absolute, { signal: AbortSignal.timeout(capturePolicy.fetchTimeoutMs) });
      if (response.ok) imported = await response.text();
    } catch {
      imported = null;
    }
    if (imported === null) {
      text = text.replace(statement, () => "");
      failed.push(absolute);
      continue;
    }
    const nested = await resolveCssImports(imported, absolute, fetcher, depth + 1);
    for (const failure of nested.failed) failed.push(failure);
    text = text.replace(statement, () => nested.text);
  }
  return { text, failed };
}

export function collectCssResources(
  cssText: string,
  base: string,
  take: (url: string, kind: "image" | "font") => string = (url) => url,
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
      const insideFont = fontRanges.some(([start, end]) => offset >= start && offset < end),
        kind = insideFont ? "font" : "image";
      resources.push({ url: absolute, kind });
      return `url("${take(absolute, kind)}")`;
    },
  );
  return { rewritten, resources };
}

interface CaptureShared {
  seen: Map<string, string>;
  nodeMap: Map<Node, Node>;
  resources: { url: string; kind: "image" | "stylesheet" | "font" }[];
  unresolved: { url: string; reason: string }[];
  fetcher: typeof fetch;
  ownerDoc: Document;
}

function cloneRoot(node: Node): Node {
  return node instanceof ShadowRoot ? node.ownerDocument.createDocumentFragment() : node.cloneNode(false);
}

function cloneWithMap(node: Node, map: Map<Node, Node>): Node {
  const rootCopy = cloneRoot(node),
    stack: [Node, Node][] = [[node, rootCopy]];
  map.set(node, rootCopy);
  while (stack.length > 0) {
    const [live, cloned] = stack.pop() ?? [node, rootCopy];
    for (let child = live.firstChild; child !== null; child = child.nextSibling) {
      const copy = cloneRoot(child);
      map.set(child, copy);
      cloned.appendChild(copy);
      if (child.firstChild !== null) stack.push([child, copy]);
    }
  }
  return rootCopy;
}

function takeUrl(shared: CaptureShared, url: string, kind: "image" | "font"): string {
  const existing = shared.seen.get(url);
  if (existing) return existing;
  const token = `${resourceTokenPrefix}${shared.seen.size}`;
  shared.seen.set(url, token);
  shared.resources.push({ url, kind });
  return token;
}

async function inlineStylesheet(
  element: Element,
  absoluteHref: string,
  shared: CaptureShared,
): Promise<void> {
  let cssText: string | null = null;
  try {
    const response = await shared.fetcher(absoluteHref, { signal: AbortSignal.timeout(capturePolicy.fetchTimeoutMs) });
    if (response.ok) cssText = await response.text();
  } catch {
    cssText = null;
  }
  if (cssText === null) {
    element.remove();
    shared.unresolved.push({ url: absoluteHref, reason: "stylesheet fetch failed" });
    return;
  }
  const imported = await resolveCssImports(cssText, absoluteHref, shared.fetcher);
  for (const failure of imported.failed) {
    shared.unresolved.push({ url: failure, reason: "stylesheet import fetch failed" });
  }
  const { rewritten } = collectCssResources(imported.text, absoluteHref, (url, kind) => takeUrl(shared, url, kind)),
    replacement = shared.ownerDoc.createElement("style");
  replacement.textContent = rewritten;
  replacement.setAttribute("data-onefile-from", absoluteHref);
  element.replaceWith(replacement);
}

async function inlineAdoptedSheets(
  live: Document | ShadowRoot,
  clone: Element | DocumentFragment,
  baseUrl: string,
  shared: CaptureShared,
): Promise<void> {
  const sheets = live.adoptedStyleSheets;
  if (sheets.length === 0) return;
  const combined: string[] = [];
  sheets.forEach((sheet, sheetIndex) => {
    try {
      const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      combined.push(text);
    } catch {
      shared.unresolved.push({ url: `(adopted stylesheet ${sheetIndex})`, reason: "adopted stylesheet unreadable" });
    }
  });
  if (combined.length === 0) return;
  const imported = await resolveCssImports(combined.join("\n"), baseUrl, shared.fetcher);
  for (const failure of imported.failed) {
    shared.unresolved.push({ url: failure, reason: "stylesheet import fetch failed" });
  }
  const { rewritten } = collectCssResources(imported.text, baseUrl, (url, kind) => takeUrl(shared, url, kind)),
    holder = shared.ownerDoc.createElement("style");
  holder.textContent = rewritten;
  holder.setAttribute("data-onefile-adopted", "true");
  const head = clone.querySelector("head");
  if (head) head.prepend(holder);
  else clone.prepend(holder);
}

function rewriteImageElement(element: Element, baseUrl: string, shared: CaptureShared): void {
  const attribute = element.hasAttribute("src") ? "src" : "poster",
    raw = (element.getAttribute(attribute) ?? "").trim();
  if (raw === "") {
    element.removeAttribute(attribute);
    shared.unresolved.push({ url: "(empty)", reason: "ephemeral source" });
    return;
  }
  if (raw.startsWith("data:")) return;
  const absolute = absolutizeHttpUrl(raw, baseUrl);
  if (!absolute) {
    element.setAttribute(attribute, missingResourceToken);
    shared.unresolved.push({ url: raw, reason: "ephemeral source" });
    return;
  }
  element.setAttribute(attribute, takeUrl(shared, absolute, "image"));
}

function rewriteSrcsetElement(element: Element, baseUrl: string, shared: CaptureShared): void {
  const raw = element.getAttribute("srcset") ?? "",
    rewritten = splitSrcset(raw)
      .map((candidate) => {
        if (candidate.url.startsWith("data:")) return candidate;
        const absolute = absolutizeHttpUrl(candidate.url, baseUrl);
        if (!absolute) return null;
        return { url: takeUrl(shared, absolute, "image"), descriptor: candidate.descriptor };
      })
      .filter((candidate) => candidate !== null);
  if (rewritten.length === 0) {
    element.removeAttribute("srcset");
    shared.unresolved.push({ url: raw, reason: "unresolvable srcset" });
  } else {
    element.setAttribute(
      "srcset",
      rewritten
        .map((candidate) => `${candidate.url}${candidate.descriptor ? ` ${candidate.descriptor}` : ""}`)
        .join(", "),
    );
  }
}

function replaceCanvas(live: ParentNode, clone: ParentNode, shared: CaptureShared): void {
  const liveCanvases = Array.from(live.querySelectorAll("canvas")),
    cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
  liveCanvases.forEach((liveCanvas, index) => {
    const cloneCanvas = cloneCanvases[index];
    if (!cloneCanvas) return;
    let snapshot: string | null = null;
    try {
      snapshot = liveCanvas.toDataURL("image/png");
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      shared.unresolved.push({ url: "(canvas snapshot)", reason: "canvas snapshot failed" });
      return;
    }
    const replacement = shared.ownerDoc.createElement("img");
    for (const attribute of ["id", "class", "style", "width", "height"]) {
      const value = liveCanvas.getAttribute(attribute);
      if (value !== null) replacement.setAttribute(attribute, value);
    }
    replacement.setAttribute("src", snapshot);
    cloneCanvas.replaceWith(replacement);
  });
}

async function captureScope(
  live: Document | ShadowRoot,
  clone: Element | DocumentFragment,
  baseUrl: string,
  shared: CaptureShared,
  depth: number,
): Promise<void> {
  clone.querySelectorAll("script").forEach((element) => element.remove());
  for (const element of Array.from(clone.querySelectorAll("link"))) {
    const rel = (element.getAttribute("rel") ?? "").toLowerCase();
    if (rel !== "stylesheet") {
      element.remove();
      continue;
    }
    const rawHref = element.getAttribute("href") ?? "",
      absoluteHref = absolutizeHttpUrl(rawHref, baseUrl);
    if (!absoluteHref) {
      element.remove();
      if (rawHref.trim() !== "") shared.unresolved.push({ url: rawHref, reason: "unresolvable stylesheet href" });
      continue;
    }
    await inlineStylesheet(element, absoluteHref, shared);
  }
  await inlineAdoptedSheets(live, clone, baseUrl, shared);
  for (const style of Array.from(clone.querySelectorAll("style"))) {
    if (style.hasAttribute("data-onefile-from") || style.hasAttribute("data-onefile-adopted")) continue;
    const imported = await resolveCssImports(style.textContent ?? "", baseUrl, shared.fetcher);
    for (const failure of imported.failed) {
      shared.unresolved.push({ url: failure, reason: "stylesheet import fetch failed" });
    }
    const { rewritten } = collectCssResources(imported.text, baseUrl, (url, kind) => takeUrl(shared, url, kind));
    style.textContent = rewritten;
  }
  clone.querySelectorAll("img[data-src], source[data-src]").forEach((element) => {
    if (!element.hasAttribute("src")) element.setAttribute("src", element.getAttribute("data-src") ?? "");
    element.removeAttribute("data-src");
  });
  clone.querySelectorAll("img[data-srcset], source[data-srcset]").forEach((element) => {
    if (!element.hasAttribute("srcset")) element.setAttribute("srcset", element.getAttribute("data-srcset") ?? "");
    element.removeAttribute("data-srcset");
  });
  clone.querySelectorAll("img[src], source[src]").forEach((element) => {
    rewriteImageElement(element, baseUrl, shared);
  });
  clone.querySelectorAll("video[poster]").forEach((element) => {
    const raw = (element.getAttribute("poster") ?? "").trim();
    if (raw === "") {
      element.removeAttribute("poster");
      shared.unresolved.push({ url: "(empty)", reason: "ephemeral source" });
      return;
    }
    if (raw.startsWith("data:")) return;
    const absolute = absolutizeHttpUrl(raw, baseUrl);
    if (!absolute) {
      element.setAttribute("poster", missingResourceToken);
      shared.unresolved.push({ url: raw, reason: "ephemeral source" });
      return;
    }
    element.setAttribute("poster", takeUrl(shared, absolute, "image"));
  });
  clone.querySelectorAll("img[srcset], source[srcset]").forEach((element) => {
    rewriteSrcsetElement(element, baseUrl, shared);
  });
  clone
    .querySelectorAll("video[src], audio[src], video > source[src], audio > source[src], embed[src], object[data]")
    .forEach((element) => {
      const attribute = element.hasAttribute("data") ? "data" : "src",
        raw = element.getAttribute(attribute) ?? "";
      element.removeAttribute(attribute);
      if (raw.trim() !== "") shared.unresolved.push({ url: raw, reason: "media capture is out of scope" });
    });
  replaceCanvas(live, clone, shared);
  const liveHosts = Array.from(live.querySelectorAll("*")).filter(
    (element): element is Element & { shadowRoot: ShadowRoot } => (element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot instanceof ShadowRoot,
  );
  for (const host of liveHosts) {
    const cloneHost = shared.nodeMap.get(host);
    if (!cloneHost || !(cloneHost instanceof Element)) continue;
    const template = shared.ownerDoc.createElement("template");
    template.setAttribute("shadowrootmode", host.shadowRoot.mode);
    if (host.shadowRoot.delegatesFocus) template.setAttribute("shadowrootdelegatesfocus", "");
    const shadowClone = cloneWithMap(host.shadowRoot, shared.nodeMap);
    template.content.append(shadowClone);
    cloneHost.append(template);
    await captureScope(host.shadowRoot, template.content, baseUrl, shared, depth);
  }
  const liveFrames = Array.from(live.querySelectorAll("iframe")),
    cloneFrames = Array.from(clone.querySelectorAll("iframe"));
  for (const [frameIndex, liveFrame] of liveFrames.entries()) {
    const cloneFrame = cloneFrames[frameIndex];
    if (!cloneFrame) continue;
    const rawSrc = liveFrame.getAttribute("src") ?? "";
    if (depth >= maxFrameDepth) {
      cloneFrame.removeAttribute("src");
      if (rawSrc.trim() !== "") shared.unresolved.push({ url: rawSrc, reason: "frame depth limit" });
      continue;
    }
    let subDocument: Document | null = null;
    try {
      subDocument = liveFrame.contentDocument;
    } catch {
      subDocument = null;
    }
    if (!subDocument?.documentElement) {
      cloneFrame.removeAttribute("src");
      if (rawSrc.trim() !== "") shared.unresolved.push({ url: rawSrc, reason: "cross-origin frame" });
      continue;
    }
    const subClone = cloneWithMap(subDocument.documentElement, shared.nodeMap);
    await captureScope(subDocument, subClone as Element, subDocument.baseURI || baseUrl, shared, depth + 1);
    cloneFrame.setAttribute("srcdoc", (subClone as Element).outerHTML);
    cloneFrame.removeAttribute("src");
  }
  clone.querySelectorAll("[style]").forEach((element) => {
    const { rewritten } = collectCssResources(
      element.getAttribute("style") ?? "",
      baseUrl,
      (url, kind) => takeUrl(shared, url, kind),
    );
    element.setAttribute("style", rewritten);
  });
}

const boundFetch: typeof fetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);

export async function captureDocument(
  doc: Document,
  baseUrl: string,
  nowMs: number,
  fetcher: typeof fetch = boundFetch,
): Promise<CapturePayload> {
  const shared: CaptureShared = {
      seen: new Map(),
      nodeMap: new Map(),
      resources: [],
      unresolved: [],
      fetcher,
      ownerDoc: doc,
    },
    resolveBase = doc.baseURI || baseUrl,
    root = cloneWithMap(doc.documentElement, shared.nodeMap);
  await captureScope(doc, root as Element, resolveBase, shared, 0);
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  return {
    pageUrl: baseUrl,
    title: doc.title,
    capturedAtMs: nowMs,
    pageHtml: `${doctype}\n${(root as Element).outerHTML}`,
    resources: shared.resources,
    unresolved: shared.unresolved,
  };
}

globalThis.onefileCapture = (_stamp: string, nowMs: number): Promise<CapturePayload> =>
  captureDocument(document, location.href, nowMs);

declare global {
  var onefileCapture: ((_stamp: string, nowMs: number) => Promise<CapturePayload>) | undefined;
}
