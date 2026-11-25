import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CSS,
  ICON_BOOKMARK,
  ICON_LIKE,
  ICON_PLAY,
  ICON_REPLY,
  ICON_REPOST_HEADER,
  ICON_RETWEET,
  ICON_THREAD,
  ICON_VIEWS,
  LIGHTBOX_HTML,
  THREAD_HTML,
  X_LINK,
  X_LOGO,
} from "./render-assets.ts";

type Json = Record<string, unknown>;

export interface RenderArchiveOptions {
  readonly folder: string;
  readonly output?: string;
  readonly textOnly?: boolean;
  readonly noFetch?: boolean;
}

export interface RenderArchiveResult {
  readonly output: string;
  readonly posts: number;
  readonly mode: "media" | "text-only";
  readonly bytes: number;
}

interface MediaItem {
  readonly kind: "photo" | "gif" | "video";
  readonly src: string;
  readonly alt: string;
  readonly unavailable?: string;
}

interface ProfileAssets {
  image: string | null;
  banner: string | null;
  profile_handle: string;
}

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEXES: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function esc(value: unknown): string {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function formatNumber(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value).replaceAll(",", ""), 10);
  return new Intl.NumberFormat("en-US").format(Number.isFinite(parsed) ? parsed : 0);
}

function parseCreatedAt(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const twitter = /^([A-Za-z]{3}) ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/u.exec(raw);
  if (twitter) {
    const month = MONTH_INDEXES[twitter[2]!];
    if (month === undefined) return null;
    const offsetMinutes = (twitter[7] === "-" ? -1 : 1) * (Number(twitter[8]) * 60 + Number(twitter[9]));
    const utc = Date.UTC(
      Number(twitter[10]), month, Number(twitter[3]),
      Number(twitter[4]), Number(twitter[5]), Number(twitter[6]),
    );
    if (!Number.isFinite(utc)) return null;
    return new Date(utc - offsetMinutes * 60_000);
  }
  const parsed = Date.parse(raw.replaceAll("Z", "+00:00"));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function fmtDate(value: unknown): string {
  const date = parseCreatedAt(value);
  if (!date) return "unknown date";
  const hours = date.getUTCHours(),
    hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${hour12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function initialsColor(seed: string): string {
  let hue = 0;
  for (const character of seed) hue = (hue * 131 + character.codePointAt(0)!) % 360;
  return `hsl(${hue} 55% 38%)`;
}

function initials(value: string): string {
  const parts = (value || "?").trim().split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  return (parts[0]!.slice(0, 1) + (parts.length > 1 ? parts[parts.length - 1]!.slice(0, 1) : "")).toUpperCase();
}

function avatarHtml(authorValue: unknown, size: number, assets: ProfileAssets | null): string {
  const author = record(authorValue),
    name = text(author["name"]) || text(author["screen_name"]) || "?",
    handle = text(author["screen_name"]) || "unknown",
    style = `width:${size}px;height:${size}px;flex-basis:${size}px`,
    image = assets?.image,
    profileHandle = assets?.profile_handle ?? "";
  if (image && handle.toLowerCase() === profileHandle.toLowerCase()) {
    return `<div class="avatar" style="${style}"><img loading="lazy" decoding="async" src="${esc(image)}" alt="${esc(name)}"></div>`;
  }
  return `<div class="avatar" style="background:${initialsColor(handle)};${style}">${esc(initials(name))}</div>`;
}

function linkify(value: unknown, urls: unknown, mentions: unknown, hashtags: unknown): string {
  let out = esc(value);
  const mentionNames = new Set(array(mentions)
    .map((mention) => typeof mention === "string" ? mention : text(record(mention)["screen_name"]))
    .filter((name) => name.length > 0)),
    tagNames = new Set(array(hashtags)
      .map((tag) => typeof tag === "string" ? tag : text(record(tag)["text"]))
      .filter((tag) => tag.length > 0));
  const specs = array(urls).map((entry): { raw: string; href: string; display: string } => {
    if (typeof entry === "string") return { raw: entry, href: entry, display: entry };
    const url = record(entry);
    return {
      raw: text(url["url"]) || text(url["raw"]),
      href: text(url["expanded_url"]) || text(url["url"]) || text(url["href"]),
      display: text(url["display_url"]) || text(url["expanded_url"]) || text(url["url"]),
    };
  }).filter((spec) => spec.raw.length > 0 && /^https?:\/\//u.test(spec.href));
  const rawUrls = [...new Map(specs.map((spec) => [spec.raw, spec])).values()]
    .sort((left, right) => right.raw.length - left.raw.length);
  for (const { raw, href, display } of rawUrls) {
    const label = (display || href).replace(/^https:\/\//u, "").replace(/^http:\/\//u, "").replace(/\/$/u, "");
    out = out.replaceAll(esc(raw), `<a href="${esc(href)}" rel="noopener">${esc(label.slice(0, 60))}</a>`);
  }
  out = out.replaceAll(/(@\w{1,20})/gu, (match, name: string) =>
    mentionNames.has(name.slice(1)) ? `<a class="mention" href="https://x.com/${esc(name.slice(1))}" rel="noopener">${esc(name)}</a>` : match);
  out = out.replaceAll(/(#\w{1,80})/gu, (match, tag: string) =>
    tagNames.has(tag.slice(1)) ? `<a class="hashtag" href="https://x.com/hashtag/${esc(tag.slice(1))}" rel="noopener">${esc(tag)}</a>` : match);
  return out;
}

function extFromUrl(value: unknown, fallback: string): string {
  const match = /\.([\dA-Za-z]{2,5})(?:\?|$)/u.exec(text(value));
  return match ? match[1]!.toLowerCase() : fallback;
}

function mediaItems(postValue: unknown, tweetId: string, quoted: boolean, mode: string, mediaDir: string, manifest: Map<string, Json>): MediaItem[] {
  const post = record(postValue),
    items: MediaItem[] = [];
  for (const [index, value] of array(post["media"]).entries()) {
    const item = record(value),
      mtype = text(item["type"]) || "photo",
      url = text(item["url"]),
      alt = text(item["alt_text"]);
    let kind: MediaItem["kind"],
      extension: string;
    if (mtype === "photo") {
      kind = "photo";
      extension = extFromUrl(url, "jpg");
    } else if (mtype === "animated_gif") {
      kind = "gif";
      extension = "mp4";
    } else {
      kind = "video";
      const variants = array(item["variants"])
        .map((variant) => record(variant))
        .filter((variant) => variant["content_type"] === "video/mp4")
        .sort((left, right) => Number(right["bitrate"] ?? 0) - Number(left["bitrate"] ?? 0));
      extension = extFromUrl(variants[0]?.["url"], "mp4");
    }
    if (mode !== "media") continue;
    const base = `${tweetId}${quoted ? "_quoted" : ""}_${index}`,
      entry = manifest.get(base),
      filename = entry ? text(entry["filename"]) : `${base}.${extension}`,
      src = `media/${filename || `${base}.${extension}`}`,
      status = entry ? text(entry["status"]) : "",
      reason = status === "skipped" || status === "failed"
        ? (text(entry?.["error"]) || `${status} during collection`)
        : existsSync(join(mediaDir, filename || `${base}.${extension}`)) ? undefined : "not archived";
    items.push({ kind, src, alt, ...(reason ? { unavailable: reason } : {}) });
  }
  return items;
}

function renderMedia(items: readonly MediaItem[]): string {
  if (items.length === 0) return "";
  const parts = [`<div class="media m${Math.min(items.length, 4)}" data-gallery>`];
  for (const { kind, src, alt, unavailable } of items) {
    if (unavailable) {
      parts.push(`<div class="unavailable-media" style="padding:8px;border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:13px">Media not archived: ${esc(unavailable)} (${esc(src)})</div>`);
      continue;
    }
    const label = esc(alt) || { photo: "Open photo", gif: "Play GIF", video: "Play video" }[kind];
    parts.push(`<a class="item" href="${esc(src)}" data-type="${kind}" data-alt="${esc(alt)}" aria-label="${label}">`);
    if (kind === "photo") {
      parts.push(`<img loading="lazy" decoding="async" alt="${esc(alt)}" src="${esc(src)}">`);
    } else if (kind === "gif") {
      parts.push(`<video preload="none" muted loop playsinline src="${esc(src)}"></video><span class="badge-gif">GIF</span>`);
    } else {
      parts.push(`<video preload="none" src="${esc(src)}"></video><span class="play">${ICON_PLAY}</span>`);
    }
    parts.push("</a>");
  }
  parts.push("</div>");
  return parts.join("");
}

function metric(icon: string, number: unknown): string {
  return `<span class="metric">${icon}<span>${formatNumber(number)}</span></span>`;
}

function renderQuoted(quotedValue: unknown, tweetId: string, mode: string, assets: ProfileAssets | null, mediaDir: string, manifest: Map<string, Json>): string {
  const quoted = record(quotedValue);
  if (Object.keys(quoted).length === 0) return "";
  if (quoted["status"] === "unavailable") {
    return '<div class="quoted"><div class="unavailable">This quote post is unavailable.</div></div>';
  }
  const author = record(quoted["author"]),
    urls = array(record(quoted["entities"])["urls"]),
    metrics = record(quoted["metrics"]);
  return `<div class="quoted"><div class="post" style="padding:0;border:0">${avatarHtml(author, 28, assets)}<div class="post-body">`
    + `<div class="p-head"><span class="p-name">${esc(text(author["name"]) || text(author["screen_name"]) || "?")}</span>`
    + `<span class="p-handle">@${esc(text(author["screen_name"]) || "unknown")}</span><span class="dot">·</span>`
    + `<span class="p-time">${esc(fmtDate(quoted["created_at"]))}</span></div>`
    + `<div class="p-text quoted-text">${linkify(quoted["full_text"], urls, null, null)}</div>`
    + renderMedia(mediaItems(quoted, tweetId, true, mode, mediaDir, manifest))
    + `<div class="metrics" style="max-width:280px">${metric(ICON_REPLY, metrics["replies"])}${metric(ICON_RETWEET, metrics["retweets"])}${metric(ICON_LIKE, metrics["likes"])}</div>`
    + "</div></div></div>";
}

function renderCard(cardValue: unknown): string {
  const card = record(cardValue);
  if (Object.keys(card).length === 0) return "";
  const title = text(card["title"]),
    description = text(card["description"]),
    url = text(card["url"]),
    bindings = record(card["bindings"]),
    choices = Object.entries(bindings)
      .filter(([key, value]) => /^poll\d+_choice\d+$/u.test(key) && typeof value === "string" && value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => `<li>${esc(value)}</li>`)
      .join("");
  if (!title && !description && !url && !choices) return "";
  const inner = (title ? `<div class="p-name">${esc(title)}</div>` : "")
    + (description ? `<div class="p-text">${esc(description)}</div>` : "")
    + (choices ? `<ul class="card-choices">${choices}</ul>` : "");
  const block = `<div class="quoted" style="margin-top:8px;padding:10px;border:1px solid var(--border);border-radius:12px">${inner}</div>`;
  return url && /^https?:\/\//u.test(url)
    ? `<a href="${esc(url)}" rel="noopener" style="display:block;text-decoration:none;color:inherit">${block}</a>`
    : block;
}

function renderPost(postValue: unknown, mode: string, assets: ProfileAssets | null, convCounts: Map<string, number>, mediaDir: string, manifest: Map<string, Json>): string {
  const post = record(postValue),
    tweetId = text(post["tweet_id"]) || "?",
    author = record(post["author"]),
    name = text(author["name"]) || text(author["screen_name"]) || "?",
    handle = text(author["screen_name"]) || "unknown",
    unavailable = post["status"] === "unavailable",
    conversationId = text(post["conversation_id"]),
    sortIndex = text(post["sort_index"]),
    parentId = post["in_reply_to_tweet_id"],
    parentAttr = parentId ? text(parentId) : "",
    convSize = convCounts.get(conversationId) ?? 1,
    showThread = conversationId.length > 0 && (Boolean(parentId) || convSize > 1),
    createdMs = parseCreatedAt(post["created_at"])?.getTime(),
    dataAttrs = ` data-tweet="${esc(tweetId)}" data-conversation="${esc(conversationId)}" data-sort-index="${esc(sortIndex)}" data-parent="${esc(parentAttr)}" data-created-ms="${createdMs ?? ""}"`;
  const headBits: string[] = [];
  if (post["repost_of"]) {
    const reposter = record(post["reposted_by"]),
      reposterName = text(reposter["name"]) || text(reposter["screen_name"]) || name;
    headBits.push(`<div class="rp">${ICON_REPOST_HEADER}<span><b>${esc(reposterName)}</b> reposted</span></div>`);
  }
  if (parentId) {
    headBits.push(`<div class="reply-note">Replying to <a href="${X_LINK}${esc(parentAttr)}" rel="noopener">post ${esc(parentAttr)}</a></div>`);
  }
  const folders = array(post["folders"]).filter((folder): folder is string => typeof folder === "string" && folder.length > 0);
  if (folders.length > 0) {
    headBits.push(`<div class="reply-note">Folders: ${folders.map((folder) => esc(folder)).join(" · ")}</div>`);
  }
  if (!unavailable && text(post["source"])) {
    headBits.push(`<div class="reply-note">via ${esc(post["source"])}</div>`);
  }
  if (text(post["in_reply_to_user_id"])) {
    headBits.push(`<div class="reply-note">to user ${esc(post["in_reply_to_user_id"])}</div>`);
  }
  const entities = record(post["entities"]),
    urlValues = array(entities["urls"]),
    isContext = mode === "context",
    quoted = record(post["quoted_tweet"]),
    quotedHtml = renderQuoted(quoted, tweetId, isContext ? "text-only" : mode, assets, mediaDir, manifest),
    cardHtml = renderCard(post["card"]),
    metrics = record(post["metrics"]);
  const metricsHtml = `<div class="metrics">${metric(ICON_REPLY, metrics["replies"])}${metric(ICON_RETWEET, metrics["retweets"])}${metric(ICON_LIKE, metrics["likes"])}${metric(ICON_BOOKMARK, metrics["bookmarks"])}`
    + `<span class="metric views">${ICON_VIEWS}<span>${formatNumber(Number(metrics["views"] ?? 0))}</span></span></div>`;
  let body: string;
  if (unavailable) {
    body = `<div class="unavailable">${esc(text(post["unavailable_reason"]) || "This post is unavailable.")}</div>`;
  } else {
    body = `<div class="p-text">${linkify(post["full_text"], urlValues, entities["mentions"], entities["hashtags"])}</div>`
      + renderMedia(mediaItems(post, tweetId, false, mode, mediaDir, manifest)) + quotedHtml + cardHtml + metricsHtml;
  }
  if (showThread && !isContext) {
    body += `<button class="thread-btn" data-thread="${esc(conversationId)}">${ICON_THREAD}Thread</button>`;
  }
  return `<article class="${isContext ? "post context-post" : "post"}" id="post-${esc(tweetId)}"${dataAttrs}>${avatarHtml(author, 40, assets)}<div class="post-body">`
    + headBits.join("")
    + `<div class="p-head"><span class="p-name">${esc(name)}</span>${author["verified"] === true ? '<span title="Verified" style="color:var(--accent)">✓</span>' : ""}${isContext ? ' <span class="context-note">thread context</span>' : ""}`
    + `<span class="p-handle">@${esc(handle)}<span class="dot"> · </span><a href="${X_LINK}${esc(tweetId)}" rel="noopener"><span class="p-time">${esc(fmtDate(post["created_at"]))}</span></a></span></div>`
    + body + "</div></article>";
}

async function httpGet(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function cachedAsset(mediaDir: string, base: string): string | null {
  if (!existsSync(mediaDir)) return null;
  const matches = readdirSync(mediaDir)
    .filter((name) => {
      const dot = name.lastIndexOf("."),
        extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
      return dot > 0 && name.slice(0, dot) === base && IMAGE_EXTENSIONS.has(extension);
    })
    .sort();
  return matches[0] ? join(mediaDir, matches[0]) : null;
}

function assetFromBytes(mediaDir: string, base: string, url: string, payload: Uint8Array, fallback: string): string {
  let extension = extFromUrl(url, fallback);
  if (!IMAGE_EXTENSIONS.has(extension)) extension = fallback;
  mkdirSync(mediaDir, { recursive: true });
  const target = join(mediaDir, `${base}.${extension}`),
    temporary = `${target}.part`;
  writeFileSync(temporary, payload);
  renameSync(temporary, target);
  return target;
}

async function fetchProfileAssets(profileValue: unknown, mediaDir: string, allowFetch: boolean): Promise<ProfileAssets> {
  const profile = record(profileValue),
    assets: ProfileAssets = { image: null, banner: null, profile_handle: text(profile["screen_name"]) };
  if (Object.keys(profile).length === 0) return assets;
  const handle = assets.profile_handle,
    imageFile = cachedAsset(mediaDir, "profile"),
    imageUrl = text(profile["profile_image_url"]);
  if (imageFile) {
    assets.image = `media/${basename(imageFile)}`;
  } else if (allowFetch && imageUrl) {
    try {
      const large = imageUrl.replace(/_normal(\.[A-Za-z0-9]+)$/u, "_400x400$1");
      assets.image = `media/${basename(assetFromBytes(mediaDir, "profile", large, await httpGet(large), "jpg"))}`;
    } catch (error) {
      process.stderr.write(`render_archive: could not fetch profile photo: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  const bannerFile = cachedAsset(mediaDir, "cover");
  if (bannerFile) {
    assets.banner = `media/${basename(bannerFile)}`;
  } else if (allowFetch && handle) {
    try {
      const page = new TextDecoder("utf-8", { fatal: false }).decode(await httpGet(`https://x.com/${handle}`)),
        match = /https:\/\/pbs\.twimg\.com\/profile_banners\/\d+\/\d+\/1500x500/u.exec(page);
      if (match) {
        assets.banner = `media/${basename(assetFromBytes(mediaDir, "cover", match[0], await httpGet(match[0]), "jpg"))}`;
      } else {
        process.stderr.write(`render_archive: no banner found on the x.com profile page for @${handle}\n`);
      }
    } catch (error) {
      process.stderr.write(`render_archive: could not fetch cover photo: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return assets;
}

export async function renderArchive(options: RenderArchiveOptions): Promise<RenderArchiveResult> {
  const folder = options.folder,
    altPath = ["posts.json", "likes.json", "bookmarks.json"]
      .map((name) => join(folder, name))
      .find((path) => {
        try {
          readFileSync(path);
          return true;
        } catch {
          return false;
        }
      });
  if (!altPath) throw new Error(`no posts.json, likes.json or bookmarks.json in ${folder}`);
  const data = record(JSON.parse(readFileSync(altPath, "utf8"))),
    meta = record(data["export_metadata"]),
    mode = options.textOnly ? "text-only" : "media",
    mediaDir = join(folder, "media"),
    output = options.output ?? join(folder, "archive.html"),
    mediaManifest = new Map(array(data["media_manifest"])
      .map((entry) => record(entry))
      .filter((entry) => typeof entry["filename"] === "string")
      .map((entry) => [text(entry["filename"]).replace(/\.[^.]+$/u, ""), entry] as const));
  let archiveKind: "posts" | "likes" | "bookmarks",
    posts: unknown[],
    profile: Json;
  if ("posts" in data) {
    archiveKind = "posts";
    posts = array(data["posts"]);
    profile = record(data["profile"]);
    if (!text(profile["screen_name"])) {
      const requested = text(meta["requested_profile"]).replace(/^@/u, "");
      if (requested) profile["screen_name"] = requested;
    }
  } else if ("likes" in data) {
    archiveKind = "likes";
    posts = array(data["likes"]);
    profile = {};
  } else if ("bookmarks" in data) {
    archiveKind = "bookmarks";
    posts = array(data["bookmarks"]);
    profile = {};
  } else {
    throw new Error(`${altPath} carries no posts, likes or bookmarks array`);
  }
  const contextPosts = archiveKind === "posts" ? array(data["context_posts"]) : [],
    contextIds = contextPosts.filter((post) => Boolean(record(post)["tweet_id"])).length,
    collection = record(meta["collection"]);
  let mediaReport: Json | null = null;
  try {
    mediaReport = record(record(JSON.parse(readFileSync(join(folder, "debug.json"), "utf8")))["media"]);
  } catch {
    mediaReport = null;
  }
  const coverage = Object.entries(collection)
    .filter(([key, value]) => key !== "reason" && typeof value === "string")
    .map(([key, value]) => key + " " + value)
    .join(", "),
    collectionReason = text(collection["reason"]),
    failedMedia = mediaReport ? array(mediaReport["failed"]).length : 0,
    skippedMedia = mediaReport ? array(mediaReport["skipped"]).length : 0;
  const assets = archiveKind === "posts"
    ? await fetchProfileAssets(Object.keys(profile).length ? profile : null, mediaDir, !options.noFetch)
    : { image: null, banner: null, profile_handle: "" };
  const kindLabel = { posts: "archive", likes: "likes archive", bookmarks: "bookmarks archive" }[archiveKind],
    visibleName = (text(profile["name"]) || text(profile["screen_name"]) || `X ${kindLabel}`).trim(),
    handle = text(profile["screen_name"]),
    stats = record(meta["stats"]),
    totalPosts = Number(stats["total_posts"] ?? posts.length) || posts.length,
    exportedAt = text(meta["exported_at"]) || "unknown date",
    available = Number(stats["available_posts"] ?? posts.filter((post) => record(post)["status"] !== "unavailable").length),
    unavailable = Number(stats["unavailable_posts"] ?? posts.length - available),
    headerAvatar = assets.image
      ? `<img loading="lazy" decoding="async" src="${esc(assets.image)}" alt="${esc(visibleName)}">`
      : esc(initials(visibleName)),
    bannerHtml = assets.banner
      ? `<div class="banner"><img loading="lazy" decoding="async" src="${esc(assets.banner)}" alt=""></div>\n`
      : '<div class="banner"></div>\n';
  const parts = [
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n',
    `<title>${esc(visibleName)} — archive</title>\n<style>${CSS}</style>\n</head>\n<body>\n`,
    `<header class="topbar"><div class="topbar-inner"><div class="logo" style="background:#16181c">${X_LOGO}</div>`
      + `<div><h1>${esc(visibleName)}</h1><p>${esc(kindLabel)} · ${formatNumber(totalPosts)} posts · exported ${esc(exportedAt)}</p></div></div></header>\n`,
  ];
  if (archiveKind === "posts") {
    parts.push(bannerHtml
      + `<section class="profile"><div class="avatar-lg" style="background:${initialsColor(handle || visibleName)}">${headerAvatar}</div>`
      + `<div class="name">${esc(visibleName)}</div><div class="handle">@${esc(handle)}</div>`
      + (text(profile["description"]) ? `<div class="bio">${esc(profile["description"])}</div>` : "")
      + (Number(profile["followers_count"] ?? 0) > 0
        ? `<div class="meta"><span><b>${formatNumber(profile["followers_count"])}</b> followers</span>`
        : '<div class="meta">')
      + `<span><b>${formatNumber(totalPosts)}</b> posts archived</span><span class="note">cumulative archive</span></div></section>\n`);
  }
  parts.push('<main class="feed">\n');
  const convCounts = new Map<string, number>();
  for (const value of [...posts, ...contextPosts]) {
    const id = text(record(value)["conversation_id"]) || "";
    convCounts.set(id, (convCounts.get(id) ?? 0) + 1);
  }
  for (const post of posts) parts.push(renderPost(post, mode, assets, convCounts, mediaDir, mediaManifest));
  if (contextPosts.length > 0) {
    parts.push('<div class="context-archive" hidden>\n');
    for (const post of contextPosts) parts.push(renderPost(post, "context", assets, convCounts, mediaDir, mediaManifest));
    parts.push("</div>\n");
  }
  const contextFailed = Number(stats["context_failed"] ?? 0),
    contextUnreachable = Number(stats["context_unreachable"] ?? 0),
    contextNote = contextIds ? ` · ${formatNumber(contextIds)} thread-context posts (text only)` : "",
    contextGapNote = contextFailed || contextUnreachable
      ? ` · ${formatNumber(contextFailed)} context pages failed, ${formatNumber(contextUnreachable)} unreachable` : "",
    statusNote = [
      coverage ? `Collection: ${coverage}${collectionReason ? " (" + collectionReason + ")" : ""}` : "",
      failedMedia ? `${failedMedia} media file(s) failed to download` : "",
      skippedMedia ? `${skippedMedia} media file(s) skipped` : "",
      "Metrics are snapshots observed at capture time.",
    ].filter(Boolean).map((note) => esc(note)).join(" · ");
  parts.push(
    `</main><footer class="footer">End of the archive · ${formatNumber(totalPosts)} posts (${formatNumber(available)} available, ${formatNumber(unavailable)} unavailable)${contextNote}${contextGapNote}<br>`
      + (statusNote ? statusNote + "<br>" : "")
      + "Generated by the local X Archive exporter — static page; one small inline script powers the media lightbox and the thread viewer.</footer>\n"
      + LIGHTBOX_HTML + THREAD_HTML + "</body>\n</html>\n",
  );
  const content = parts.join("");
  writeFileSync(output, content, "utf8");
  const result = { output, posts: posts.length, mode, bytes: Buffer.byteLength(content, "utf8") } as const;
  process.stderr.write(`render_archive: wrote ${output} (${(result.bytes / (1024 * 1024)).toFixed(1)} MB, ${result.posts} posts, mode=${mode})\n`);
  return result;
}
