import { itemUrl, type HnItem, type ThreadArchive } from "./thread.ts";

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? escape(url.href) : undefined;
  } catch {
    return undefined;
  }
}

/** Reconstruct only HN's small formatting vocabulary; never copy arbitrary HTML/attributes. */
function bodyHtml(value: string): string {
  const tokens = value.split(/(<[^>]*>)/gu);
  return tokens.map((token) => {
    if (/^<\/?(?:p|i|em|b|strong|pre|code|blockquote|a)>$|^<br\s*\/?>$/iu.test(token)) return token.toLowerCase();
    const link = /^<a\s+href="([^"]*)"(?:\s+rel="nofollow")?\s*>$/iu.exec(token);
    if (link?.[1]) {
      const url = safeUrl(link[1]);
      if (url) return `<a href="${url}" rel="noreferrer">`;
    }
    // Preserve character references as text, not as markup or attributes.
    return escape(token).replace(/&amp;((?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/giu, "&$1");
  }).join("");
}

function metadata(item: HnItem): string {
  const time = item.time === undefined ? undefined : new Date(item.time * 1000);
  const date = time && Number.isFinite(time.getTime()) ? time.toISOString() : "";
  return `<small>${escape(item.by ?? "[unknown]")}${date ? ` · <time>${date}</time>` : ""} · <a href="${itemUrl(item.id)}">#${item.id}</a>${item.score === undefined ? "" : ` · ${item.score} points`}${item.dead ? " · [dead]" : ""}${item.deleted ? " · [deleted]" : ""}</small>`;
}

export function renderThread(archive: ThreadArchive): string {
  const byId = new Map(archive.items.map((item) => [item.id, item]));
  const root = byId.get(archive.rootId);
  if (!root) throw new Error("Archive root is missing.");
  const title = root.title ?? `HN thread ${root.id}`;
  const link = root.url && safeUrl(root.url);
  const output = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">',
    `<title>${escape(title)}</title>`,
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:76rem;margin:2rem auto;padding:0 1rem;background:#f6f6ef;color:#222}h1{line-height:1.2}small{color:#555}a{color:#754100;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #d9d9cf;padding:.8rem 0;padding-left:var(--indent,0rem)}.text{overflow-wrap:anywhere;white-space:pre-wrap}p{margin:.6em 0}header{margin-bottom:1.5rem}</style></head><body>',
    `<header><h1>${bodyHtml(title)}</h1>${metadata(root)}${link ? `<p><a href="${link}" rel="noreferrer">${link}</a></p>` : ""}`,
    `<p>Captured ${escape(archive.capturedAt)} · ${archive.items.reduce((count, item) => count + (item.kids?.length ?? 0), 0)} comment records · <a href="${itemUrl(archive.requestedId)}">Requested item</a></p>`,
    `<div class="text">${bodyHtml(root.text ?? "")}</div></header>`,
  ];
  // Iterative depth-first rendering preserves sibling order without recursion or deep DOM nesting.
  const stack = [...(root.parts ?? []), ...(root.kids ?? [])].reverse().map((id) => ({ id, depth: 0 }));
  while (stack.length) {
    const next = stack.pop()!;
    const item = byId.get(next.id);
    if (!item) throw new Error(`Archive item ${next.id} is missing.`);
    output.push(`<article id="item-${item.id}" style="--indent:${Math.min(next.depth, 12)}rem">${metadata(item)}${item.type === "pollopt" ? " · Poll option" : ""}<div class="text">${bodyHtml(item.text ?? "")}</div></article>`);
    for (const id of [...(item.kids ?? [])].reverse()) stack.push({ id, depth: next.depth + 1 });
  }
  const json = JSON.stringify(archive).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  output.push(`<script type="application/json" id="hn-archive">${json}</script></body></html>\n`);
  return output.join("\n");
}
