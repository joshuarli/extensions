const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface HqTracks {
  readonly videoUrl: string;
  readonly audioUrl: string;
}

export function shortcodeToMediaId(shortcode: string): string {
  let value = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
  if (value === "") throw new Error("Invalid Instagram shortcode.");
  let result = 0;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Invalid Instagram shortcode.");
    result = result * ALPHABET.length + digit;
  }
  return String(result);
}

function attribute(attrs: string, name: string): string {
  return new RegExp(name + '="([^"]*)"', "u").exec(attrs)?.[1] ?? "";
}

export function parseDashTracks(manifest: string): HqTracks | null {
  let video: { url: string; area: number; bandwidth: number } | null = null;
  let audio: { url: string; bandwidth: number } | null = null;
  for (const match of manifest.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gu)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const url = /<BaseURL>([^<]+)<\/BaseURL>/u.exec(body)?.[1]?.trim() ?? "";
    if (!url.startsWith("https://")) continue;
    const codecs = attribute(attrs, "codecs");
    const bandwidth = Number(attribute(attrs, "bandwidth")) || 0;
    if (/^mp4a/u.test(codecs) || /audio/u.test(attribute(attrs, "mimeType"))) {
      if (audio === null || bandwidth > audio.bandwidth) audio = { url, bandwidth };
      continue;
    }
    const width = Number(attribute(attrs, "width")) || 0;
    const height = Number(attribute(attrs, "height")) || 0;
    const area = width * height;
    if (area === 0) continue;
    if (video === null || area > video.area || (area === video.area && bandwidth > video.bandwidth)) {
      video = { url, area, bandwidth };
    }
  }
  if (video === null || audio === null) return null;
  return { videoUrl: video.url, audioUrl: audio.url };
}
