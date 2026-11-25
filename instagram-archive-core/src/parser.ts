import type { MediaKind, MediaRef, Post } from "./types.ts";

const PLACEHOLDER = /(?:rsrc\.php|\/null\.(?:jpg|png|gif|webp))(?:$|[?#])/iu;
const SHORTCODE = /^[A-Za-z0-9_-]+$/u;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function area(width: unknown, height: unknown): number {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 0;
  const h = typeof height === "number" && Number.isFinite(height) ? height : 0;
  return w * h;
}

function best(variants: unknown, kind: MediaKind): MediaRef | null {
  let bestRef: MediaRef | null = null;
  let bestArea = -1;
  for (const item of array(variants)) {
    const node = object(item);
    const url = text(node["url"]);
    if (url === null || PLACEHOLDER.test(url)) continue;
    const size = area(node["width"], node["height"]);
    if (size <= bestArea) continue;
    bestArea = size;
    bestRef = {
      url,
      kind,
      width: typeof node["width"] === "number" ? node["width"] : 0,
      height: typeof node["height"] === "number" ? node["height"] : 0,
    };
  }
  return bestRef;
}

function captionOf(node: Record<string, unknown>): string | null {
  const caption = object(node["caption"]);
  const direct = text(caption["text"]);
  if (direct !== null) return direct;
  const edges = array(object(node["edge_media_to_caption"])["edges"]);
  const first = object(object(edges[0])["node"]);
  return text(first["text"]);
}

export class InstagramParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramParseError";
  }
}

export function parseTimelineNode(raw: unknown, usernameHint: string | null = null): Post | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const node = raw as Record<string, unknown>;
  const shortcode = text(node["code"]);
  if (shortcode === null) return null;
  if (!SHORTCODE.test(shortcode)) {
    throw new InstagramParseError("Unrecognized shortcode in timeline node.");
  }
  const owner = object(node["user"]);
  const username = text(owner["username"]) ?? usernameHint;
  const caption = captionOf(node);
  const carousel = array(node["carousel_media"]);
  const media: MediaRef[] = [];

  if (node["media_type"] === 8 || carousel.length > 0) {
    for (const child of carousel) {
      const item = object(child);
      const ref = item["media_type"] === 2
        ? best(item["video_versions"], "video")
        : best(object(item["image_versions2"])["candidates"], "image");
      if (ref !== null) media.push(ref);
    }
    if (media.length === 0) {
      throw new InstagramParseError("Carousel " + shortcode + " had no usable media.");
    }
    return { shortcode, username, postType: "carousel", caption, media };
  }

  const isVideo = node["media_type"] === 2
    || node["product_type"] === "clips"
    || node["product_type"] === "igtv"
    || array(node["video_versions"]).length > 0;
  const ref = isVideo
    ? best(node["video_versions"], "video")
    : best(object(node["image_versions2"])["candidates"], "image");
  if (ref === null) {
    throw new InstagramParseError("Post " + shortcode + " had no usable media.");
  }
  return { shortcode, username, postType: isVideo ? "video" : "image", caption, media: [ref] };
}

export function parseTimelinePage(raw: readonly unknown[], usernameHint: string | null = null): Post[] {
  const posts: Post[] = [];
  for (const node of raw) {
    const post = parseTimelineNode(node, usernameHint);
    if (post === null) {
      throw new InstagramParseError("Timeline page contained an unrecognized node.");
    }
    posts.push(post);
  }
  return posts;
}
