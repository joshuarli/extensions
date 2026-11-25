import type { DiscoveredPost } from "./post.ts";

export const TOPIC_VERSION = "topic-1";

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

export const RELEVANCE_THRESHOLD = 3;

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
