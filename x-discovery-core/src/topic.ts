import { Schema } from "effect";
import type { ProjectConfig } from "./project.ts";
import { projectVersion } from "./project.ts";
import type { DiscoveredPost } from "./post.ts";

export const TopicJudgmentSchema = Schema.Struct({
  tweet_id: Schema.String,
  verdict: Schema.Literals(["relevant", "unrelated", "insufficient_evidence"]),
  score: Schema.Number,
  matched_terms: Schema.Array(Schema.String),
  penalized_terms: Schema.optional(Schema.Array(Schema.String)),
  reason: Schema.String,
  version: Schema.String,
});

export type TopicJudgment = Schema.Schema.Type<typeof TopicJudgmentSchema>;
export type TopicVerdict = TopicJudgment["verdict"];

export function classifyTopic(post: DiscoveredPost, project: ProjectConfig): TopicJudgment {
  const text = post.full_text.trim();
  const version = projectVersion(project);
  const base = { tweet_id: post.tweet_id, penalized_terms: [] as string[], version };
  if (text.length < 10) {
    return {
      ...base,
      matched_terms: [],
      verdict: "insufficient_evidence",
      score: 0,
      reason: "Not enough text to judge; the meaning may be in an image.",
    };
  }
  const normalized = text
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/\bt\.co\/\S+/gu, " ")
    .replace(/@[A-Za-z0-9_]+/gu, " ")
    .toLowerCase()
    .normalize("NFKC");
  const matched_terms: string[] = [];
  const penalized_terms: string[] = [];
  let score = 0;
  for (const [term, weight] of project.topic_terms) {
    if (normalized.includes(term.toLowerCase())) {
      matched_terms.push(term);
      score += weight;
    }
  }
  for (const [term, weight] of project.negative_terms ?? []) {
    if (normalized.includes(term.toLowerCase())) {
      penalized_terms.push(term);
      score -= weight;
    }
  }
  const verdict = score >= project.relevance_threshold ? "relevant" : "unrelated";
  return {
    ...base,
    penalized_terms,
    matched_terms,
    score,
    verdict,
    reason: verdict === "relevant"
      ? "Matched " + matched_terms.join(", ") + "."
      : penalized_terms.length > 0
        ? "Matched " + (matched_terms.join(", ") || "none") + " but penalized " + penalized_terms.join(", ") + "."
        : "No strong signal for " + project.id + " in the text.",
  };
}
