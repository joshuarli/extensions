type MediaKind = "photo" | "video";

export interface MediaJob {
  tweet_id: string;
  index: number;
  kind: MediaKind;
  url: string;
  filename: string;
}

export interface MediaPlan {
  jobs: MediaJob[];
  missing: number;
}

type Record_ = Record<string, unknown>;

function object(value: unknown): Record_ | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record_ : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "");
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function extensionFromUrl(url: string, fallback: string): string {
  try {
    const match = /\.([a-z0-9]{2,5})$/iu.exec(new URL(url).pathname);
    const ext = match?.[1]?.toLowerCase();
    if (ext && IMAGE_EXTENSIONS.has(ext)) return ext === "jpeg" ? "jpg" : ext;
    if (ext === "mp4") return "mp4";
    return fallback;
  } catch {
    return fallback;
  }
}

function mediaFromArray(
  value: unknown,
  tweetId: string,
  infix: string,
  jobs: MediaJob[],
  missing: { count: number },
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    missing.count += 1;
    return;
  }
  for (const [index, item] of value.entries()) {
    const media = object(item);
    if (!media) {
      missing.count += 1;
      continue;
    }
    const type = string(media["type"]);
    if (type === "photo") {
      const url = string(media["url"]);
      if (!url) {
        missing.count += 1;
        continue;
      }
      const ext = extensionFromUrl(url, "jpg");
      jobs.push({ tweet_id: tweetId, index, kind: "photo", url,
        filename: tweetId + infix + "_" + index + "." + ext });
      continue;
    }
    if (type === "video" || type === "animated_gif") {
      const variants: Array<{ bitrate: number; url: string }> = [];
      for (const variant of Array.isArray(media["variants"]) ? media["variants"] : []) {
        const record = object(variant);
        const url = record ? string(record["url"]) : null;
        const contentType = record ? string(record["content_type"]) : null;
        if (record && url && contentType === "video/mp4") {
          variants.push({ bitrate: number(record["bitrate"]), url });
        }
      }
      variants.sort((a, b) => b.bitrate - a.bitrate);
      const best = variants[0];
      if (!best) {
        missing.count += 1;
        continue;
      }
      jobs.push({ tweet_id: tweetId, index, kind: "video", url: best.url,
        filename: tweetId + infix + "_" + index + ".mp4" });
      continue;
    }
    missing.count += 1;
  }
}

export function collectMediaJobs(posts: readonly unknown[]): MediaPlan {
  const jobs: MediaJob[] = [];
  const missing = { count: 0 };
  for (const value of posts) {
    const post = object(value);
    if (!post || string(post["status"]) !== "available") continue;
    const tweetId = string(post["tweet_id"]);
    if (!tweetId) {
      missing.count += 1;
      continue;
    }
    const id = sanitizeId(tweetId) || "unknown";
    mediaFromArray(post["media"], id, "", jobs, missing);
    const quoted = object(post["quoted_tweet"]);
    if (quoted && quoted["status"] !== "unavailable") {
      mediaFromArray(quoted["media"], id, "_quoted", jobs, missing);
    }
  }
  return { jobs, missing: missing.count };
}
