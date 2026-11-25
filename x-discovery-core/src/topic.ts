import { Schema } from "effect";
import type { ProjectConfig } from "./project.ts";
import { projectVersion } from "./project.ts";
import type { DiscoveredPost } from "./post.ts";

export const TopicJudgmentSchema = Schema.Struct({
  tweet_id: Schema.String,
  verdict: Schema.Literals(["relevant", "unrelated", "insufficient_evidence"]),
  score: Schema.Number,
  matched_terms: Schema.Array(Schema.String),
  reason: Schema.String,
  version: Schema.String,
});

export type TopicJudgment = Schema.Schema.Type<typeof TopicJudgmentSchema>;
export type TopicVerdict = TopicJudgment["verdict"];

export function classifyTopic(post: DiscoveredPost, project: ProjectConfig): TopicJudgment {
  const text = post.full_text.trim();
  const version = projectVersion(project);
  if (text.length < 10) {
    return {
      tweet_id: post.tweet_id,
      verdict: "insufficient_evidence",
      score: 0,
      matched_terms: [],
      reason: "Not enough text to judge; the meaning may be in an image.",
      version,
    };
  }
  const normalized = text.toLowerCase().normalize("NFKC");
  const matched_terms: string[] = [];
  let score = 0;
  for (const [term, weight] of project.topic_terms) {
    if (normalized.includes(term.toLowerCase())) {
      matched_terms.push(term);
      score += weight;
    }
  }
  return {
    tweet_id: post.tweet_id,
    verdict: score >= project.relevance_threshold ? "relevant" : "unrelated",
    score,
    matched_terms,
    reason: score >= project.relevance_threshold
      ? "Matched " + matched_terms.join(", ") + "."
      : "No strong signal for " + project.id + " in the text.",
    version,
  };
}
