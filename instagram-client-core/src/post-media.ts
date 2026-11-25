import { Schema } from "effect";

export interface PageMedia {
  readonly url: string;
  readonly kind: "image" | "video";
  readonly width: number;
  readonly height: number;
}

export class PostMediaUnavailable extends Error {
  readonly shortcode: string;

  constructor(shortcode: string) {
    super("Instagram did not expose media for " + shortcode + ".");
    this.shortcode = shortcode;
    this.name = "PostMediaUnavailable";
  }
}

const CandidateSchema = Schema.Struct({
  url: Schema.String,
  width: Schema.optional(Schema.Number),
  height: Schema.optional(Schema.Number),
});

const MediaFields = {
  image_versions2: Schema.optional(Schema.NullOr(Schema.Struct({ candidates: Schema.Array(CandidateSchema) }))),
  video_versions: Schema.optional(Schema.NullOr(Schema.Array(CandidateSchema))),
};

const EntrySchema = Schema.Struct(MediaFields);
const WebItemSchema = Schema.Struct({
  ...MediaFields,
  code: Schema.String,
  carousel_media: Schema.optional(Schema.NullOr(Schema.Array(EntrySchema))),
});

type Candidate = Schema.Schema.Type<typeof CandidateSchema>;
type Entry = Schema.Schema.Type<typeof EntrySchema>;
type WebItem = Schema.Schema.Type<typeof WebItemSchema>;

function entries(value: object): readonly [string, unknown][] {
  return Object.entries(value);
}

function findWebItem(value: unknown, shortcode: string): unknown {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findWebItem(child, shortcode);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, child] of entries(value)) {
    if (key === "xdt_api__v1__media__shortcode__web_info" && typeof child === "object" && child !== null) {
      for (const [itemKey, items] of entries(child)) {
        if (itemKey !== "items" || !Array.isArray(items)) continue;
        for (const item of items) {
          if (typeof item !== "object" || item === null) continue;
          if (entries(item).some(([codeKey, code]) => codeKey === "code" && code === shortcode)) return item;
        }
      }
    }
    const found = findWebItem(child, shortcode);
    if (found !== undefined) return found;
  }
  return undefined;
}

function best(candidates: readonly Candidate[], kind: PageMedia["kind"]): PageMedia | null {
  let result: PageMedia | null = null;
  let area = -1;
  for (const candidate of candidates) {
    if (!candidate.url.startsWith("https://")) continue;
    const width = candidate.width ?? 0;
    const height = candidate.height ?? 0;
    if (width * height <= area) continue;
    area = width * height;
    result = { url: candidate.url, kind, width, height };
  }
  return result;
}

function entryMedia(entry: Entry): PageMedia | null {
  const videos = entry.video_versions ?? [];
  if (videos.length > 0) return best(videos, "video");
  return best(entry.image_versions2?.candidates ?? [], "image");
}

export function parsePostMedia(scripts: readonly string[], shortcode: string): PageMedia[] {
  for (const script of scripts) {
    let payload: unknown;
    try {
      payload = JSON.parse(script);
    } catch {
      continue;
    }
    const raw = findWebItem(payload, shortcode);
    if (raw === undefined) continue;
    const decoded = Schema.decodeUnknownOption(WebItemSchema)(raw);
    if (decoded._tag === "None") continue;
    const item: WebItem = decoded.value;
    const slides: readonly Entry[] = item.carousel_media ?? [item];
    const seen = new Set<string>();
    const media: PageMedia[] = [];
    for (const slide of slides) {
      const resolved = entryMedia(slide);
      if (resolved === null || seen.has(resolved.url)) continue;
      seen.add(resolved.url);
      media.push(resolved);
    }
    if (media.length > 0) return media;
  }
  return [];
}
