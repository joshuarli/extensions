import type { DiscoveredPost } from "./post.ts";

export const TOPIC_VERSION = "topic-2";

const WEIGHTED_TERMS: readonly (readonly [string, number])[] = [
  ["criterion", 3],
  ["mubi", 3],
  ["arthouse", 3],
  ["avant-garde", 3],
  ["rare film", 3],
  ["short film", 3],
  ["film festival", 3],
  ["cannes", 3],
  ["berlinale", 3],
  ["venice film festival", 3],
  ["auteur", 3],
  ["iranian cinema", 3],
  ["world cinema", 3],
  ["independent film", 3],
  ["letterboxd", 2],
  ["4k bluray", 2],
  ["blu-ray", 2],
  ["bluray", 2],
  ["remux", 2],
  ["1080p", 2],
  ["eng subs", 2],
  ["subtitled", 2],
  ["cinematography", 2],
  ["film", 2],
  ["cinema", 2],
  ["director", 2],
  ["dir.", 2],
  ["screening", 1],
  ["movie", 1],
];

export const RELEVANCE_THRESHOLD = 2;

export type TopicVerdict = "relevant" | "unrelated" | "insufficient_evidence";

export interface TopicJudgment {
  tweet_id: string;
  verdict: TopicVerdict;
  score: number;
  matched_terms: string[];
  reason: string;
  version: string;
}

export function classifyTopic(post: DiscoveredPost): TopicJudgment {
  const text = post.full_text.trim();
  if (text.length < 10) {
    return {
      tweet_id: post.tweet_id,
      verdict: "insufficient_evidence",
      score: 0,
      matched_terms: [],
      reason: "Not enough text to judge; the meaning may be in an image.",
      version: TOPIC_VERSION,
    };
  }
  const normalized = text.toLowerCase().normalize("NFKC");
  const matched_terms: string[] = [];
  let score = 0;
  for (const [term, weight] of WEIGHTED_TERMS) {
    if (normalized.includes(term)) {
      matched_terms.push(term);
      score += weight;
    }
  }
  return {
    tweet_id: post.tweet_id,
    verdict: score >= RELEVANCE_THRESHOLD ? "relevant" : "unrelated",
    score,
    matched_terms,
    reason: score >= RELEVANCE_THRESHOLD
      ? "Matched " + matched_terms.join(", ") + "."
      : "No strong cinema signal in the text.",
    version: TOPIC_VERSION,
  };
}
