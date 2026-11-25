import type { DiscoveredPost } from "./post.ts";

const WEIGHTED_TERMS: readonly (readonly [string, number])[] = [
  ["criterion", 3],
  ["mubi", 3],
  ["arthouse", 3],
  ["auteur", 3],
  ["film festival", 3],
  ["cannes", 3],
  ["berlinale", 3],
  ["venice film festival", 3],
  ["letterboxd", 2],
  ["4k bluray", 2],
  ["blu-ray", 2],
  ["subtitled", 2],
  ["independent film", 2],
  ["world cinema", 2],
  ["cinematography", 1],
  ["film", 1],
  ["cinema", 1],
  ["director", 1],
  ["screening", 1],
  ["movie", 1],
];

export const ARTHOUSE_THRESHOLD = 3;

const DRIVE_HOSTS: readonly string[] = [
  "drive.google.com",
  "docs.google.com",
  "mega.nz",
  "mediafire.com",
  "1drv.ms",
  "onedrive.live.com",
  "dropbox.com",
  "archive.org",
  "pixeldrain.com",
  "wetransfer.com",
  "filer.io",
];

export interface ExtractedLink {
  url: string;
  host: string;
  display_url: string;
}

export interface PostSignal {
  tweet_id: string;
  author_handle: string;
  score: number;
  matched_terms: string[];
  links: ExtractedLink[];
  is_arthouse: boolean;
}

export interface AccountFinding {
  author_id: string;
  handle: string;
  posts: number;
  arthouse_posts: number;
  score: number;
  drive_links: number;
  sample_links: string[];
}

function isDriveHost(host: string): boolean {
  return DRIVE_HOSTS.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export function extractLinks(post: DiscoveredPost): ExtractedLink[] {
  const textLinks = post.full_text.match(/https?:\/\/[^\s<>"']+/gu) ?? [];
  const candidates = [...post.urls.map((link) => link.url), ...textLinks];
  const seen = new Set<string>();
  const result: ExtractedLink[] = [];
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const host = parsed.hostname.replace(/^www\./u, "").toLowerCase();
    if (!isDriveHost(host)) continue;
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({
      url,
      host,
      display_url: post.urls.find((link) => link.url === candidate)?.display_url ?? host,
    });
  }
  return result;
}

export function classifyPost(post: DiscoveredPost): PostSignal {
  const text = post.full_text.toLowerCase().normalize("NFKC");
  const matched_terms: string[] = [];
  let score = 0;
  for (const [term, weight] of WEIGHTED_TERMS) {
    if (text.includes(term)) {
      matched_terms.push(term);
      score += weight;
    }
  }
  const links = extractLinks(post);
  return {
    tweet_id: post.tweet_id,
    author_handle: post.author_handle,
    score,
    matched_terms,
    links,
    is_arthouse: score >= ARTHOUSE_THRESHOLD,
  };
}

export function classifyPosts(posts: readonly DiscoveredPost[]): PostSignal[] {
  return posts.map(classifyPost);
}

export function summarizeAccounts(
  posts: readonly DiscoveredPost[],
  signals: readonly PostSignal[],
): AccountFinding[] {
  const byTweet = new Map(signals.map((signal) => [signal.tweet_id, signal]));
  const accounts = new Map<string, AccountFinding>();
  for (const post of posts) {
    const signal = byTweet.get(post.tweet_id);
    const existing = accounts.get(post.author_id) ?? {
      author_id: post.author_id,
      handle: post.author_handle,
      posts: 0,
      arthouse_posts: 0,
      score: 0,
      drive_links: 0,
      sample_links: [],
    };
    existing.posts += 1;
    if (signal?.is_arthouse) existing.arthouse_posts += 1;
    if (signal) {
      existing.score += signal.score;
      existing.drive_links += signal.links.length;
      for (const link of signal.links) {
        if (existing.sample_links.length < 3 && !existing.sample_links.includes(link.url)) {
          existing.sample_links.push(link.url);
        }
      }
    }
    accounts.set(post.author_id, existing);
  }
  return [...accounts.values()].sort((a, b) =>
    b.score - a.score || b.drive_links - a.drive_links || a.handle.localeCompare(b.handle));
}
