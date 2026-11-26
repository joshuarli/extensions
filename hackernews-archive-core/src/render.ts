import { itemUrl, type HnItem, type ThreadArchive } from "./thread.ts";

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// The HN API returns HTML-encoded text and titles. Preserve references only in text contexts.
function escapeText(value: string): string {
  return escape(value).replace(/&amp;((?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/giu, "&$1");
}

function decodeLinkAttribute(value: string): string {
  return value.replace(/&(#(?:[0-9]+|x[0-9a-f]+)|amp|quot|apos|lt|gt);/giu, (match: string, entity: string) => {
    switch (entity.toLowerCase()) {
      case "amp": return "&";
      case "quot": return '"';
      case "apos": return "'";
      case "lt": return "<";
      case "gt": return ">";
    }
    if (!entity.startsWith("#")) return match;
    const hex = entity[1]?.toLowerCase() === "x";
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : "\ufffd";
  });
}

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? escape(url.href) : undefined;
  } catch {
    return undefined;
  }
}

/** Reconstruct only HN's formatting vocabulary, balancing each fragment independently. */
function bodyHtml(value: string): string {
  const output: string[] = [], stack: string[] = [];
  function close(tag: string): void {
    const index = stack.lastIndexOf(tag);
    if (index < 0) return;
    while (stack.length > index) output.push(`</${stack.pop()!}>`);
  }
  function open(tag: string, html: string): void {
    // HN uses implicit paragraph endings, including before code blocks.
    if (tag === "p" || tag === "pre" || tag === "blockquote") close("p");
    if (tag === "a") close("a");
    if (stack.length >= 64) return;
    stack.push(tag);
    output.push(html);
  }
  for (const token of value.split(/(<[^>]*>)/gu)) {
    const simple = /^<(\/?)(p|i|em|b|strong|pre|code|blockquote)>$/iu.exec(token);
    if (simple?.[2]) {
      const tag = simple[2].toLowerCase();
      if (simple[1]) close(tag);
      else open(tag, `<${tag}>`);
      continue;
    }
    if (/^<br\s*\/?>$/iu.test(token)) { output.push("<br>"); continue; }
    if (/^<\/a>$/iu.test(token)) { close("a"); continue; }
    const link = /^<a\s+href=(?:"([^"]*)"|'([^']*)')(?:\s+rel=(?:"[a-z\s-]*"|'[a-z\s-]*'))?\s*>$/iu.exec(token);
    const href = link?.[1] ?? link?.[2];
    if (href) {
      const url = safeUrl(decodeLinkAttribute(href));
      if (url) { open("a", `<a href="${url}" rel="noreferrer">`); continue; }
    }
    output.push(escapeText(token));
  }
  while (stack.length) output.push(`</${stack.pop()!}>`);
  return output.join("");
}

function metadata(item: HnItem): string {
  const time = item.time === undefined ? undefined : new Date(item.time * 1000);
  const date = time && Number.isFinite(time.getTime()) ? time.toISOString() : "";
  const score = item.score === undefined ? "" : ` · ${item.score} ${item.type === "pollopt" ? "votes" : "points"}`;
  return `<small>${escape(item.by ?? "[unknown]")}${date ? ` · <time>${date}</time>` : ""} · <a href="${itemUrl(item.id)}">#${item.id}</a>${score}${item.dead ? " · [dead]" : ""}${item.deleted ? " · [deleted]" : ""}</small>`;
}

export function renderThread(archive: ThreadArchive): string {
  const byId = new Map(archive.items.map((item) => [item.id, item]));
  const root = byId.get(archive.rootId);
  if (!root) throw new Error("Archive root is missing.");
  const title = escapeText(root.title ?? `HN thread ${root.id}`);
  const link = root.url && safeUrl(root.url);
  const count = archive.items.reduce((total, item) => total + (item.kids?.length ?? 0), 0);
  const reported = root.descendants === undefined ? "" : ` (HN reported ${root.descendants})`;
  const output = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
    `<title>${title}</title>`,
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:76rem;margin:2rem auto;padding:0 1rem;background:#f6f6ef;color:#222}h1{line-height:1.2;overflow-wrap:anywhere}small{color:#555}a{color:#754100;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #d9d9cf;padding:.8rem 0;padding-left:min(var(--indent,0rem),25vw)}.text{overflow-wrap:anywhere;white-space:pre-wrap}p{margin:.6em 0}header{margin-bottom:1.5rem}:target{outline:2px solid #c87a38;outline-offset:3px}</style></head><body>',
    `<header id="item-${root.id}"><h1>${title}</h1>${metadata(root)}${link ? `<p><a href="${link}" rel="noreferrer">${link}</a></p>` : ""}`,
    `<p>Captured ${escape(archive.capturedAt)} · ${count} comment records${reported} · <a href="#item-${archive.requestedId}">Requested item</a></p>`,
    `<div class="text">${bodyHtml(root.text ?? "")}</div></header>`,
  ];
  // Iterative depth-first rendering preserves sibling order without recursion or deep DOM nesting.
  const stack = [...(root.parts ?? []), ...(root.kids ?? [])].reverse().map((id) => ({ id, parent: root.id, depth: 0 }));
  while (stack.length) {
    const next = stack.pop()!;
    const item = byId.get(next.id);
    if (!item) throw new Error(`Archive item ${next.id} is missing.`);
    output.push(`<article id="item-${item.id}" style="--indent:${Math.min(next.depth, 12)}rem">${metadata(item)}${item.type === "pollopt" ? " · Poll option" : ""} · <small><a href="#item-${next.parent}">Parent</a></small><div class="text">${bodyHtml(item.text ?? "")}</div></article>`);
    for (const id of [...(item.kids ?? [])].reverse()) stack.push({ id, parent: item.id, depth: next.depth + 1 });
  }
  const json = JSON.stringify(archive).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  output.push(`<script type="application/json" id="hn-archive">${json}</script></body></html>\n`);
  return output.join("\n");
}
