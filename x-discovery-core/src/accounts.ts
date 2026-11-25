import { Schema } from "effect";
import type { ResourceLink } from "./links.ts";
import { sourceUrl, type DiscoveredPost } from "./post.ts";
import type { TopicJudgment } from "./topic.ts";

export const ACCOUNT_VERSION = "accounts-3";

export const AccountExampleSchema = Schema.Struct({
  source_url: Schema.String,
  text: Schema.String,
  score: Schema.Number,
  reason: Schema.String,
});

export type AccountExample = Schema.Schema.Type<typeof AccountExampleSchema>;

export const AccountFindingSchema = Schema.Struct({
  author_id: Schema.String,
  handle: Schema.String,
  role: Schema.Literals(["author", "curator", "both"]),
  posts_examined: Schema.Number,
  relevant_posts: Schema.Number,
  relevant_ratio: Schema.Number,
  consistency: Schema.Number,
  sample_sources: Schema.Array(Schema.Literals(["feed", "profile"])),
  score: Schema.Number,
  resource_links: Schema.Number,
  link_examples: Schema.Array(Schema.String),
  examples: Schema.Array(AccountExampleSchema),
  first_seen: Schema.String,
  last_seen: Schema.String,
  uncertainty: Schema.Literals(["thin", "moderate", "low"]),
  reason: Schema.String,
  version: Schema.String,
});

export type AccountFinding = Schema.Schema.Type<typeof AccountFindingSchema>;

export function deriveAccounts(
  posts: readonly DiscoveredPost[],
  topics: readonly TopicJudgment[],
  links: readonly ResourceLink[],
): AccountFinding[] {
  const topicByTweet = new Map(topics.map((judgment) => [judgment.tweet_id, judgment]));
  const accounts = new Map<string, {
    posts: DiscoveredPost[];
    relevant: Array<{ post: DiscoveredPost; judgment: TopicJudgment }>;
    links: Set<string>;
    linkUrls: Map<string, string>;
  }>();
  for (const post of posts) {
    const account = accounts.get(post.author_id) ?? {
      posts: [], relevant: [], links: new Set<string>(), linkUrls: new Map<string, string>(),
    };
    account.posts.push(post);
    const judgment = topicByTweet.get(post.tweet_id);
    if (judgment?.verdict === "relevant") account.relevant.push({ post, judgment });
    accounts.set(post.author_id, account);
  }
  for (const link of links) {
    const post = posts.find((candidate) => candidate.tweet_id === link.source_tweet_id);
    if (!post) continue;
    const account = accounts.get(post.author_id);
    account?.links.add(link.dedupe_key);
    account?.linkUrls.set(link.dedupe_key, link.url);
  }
  return [...accounts.entries()].map(([authorId, account]) => {
    const handles = account.posts.map((post) => post.author_handle);
    const times = account.posts.map((post) => post.observed_at).sort();
    const curates = account.relevant.some(({ post }) => post.relationship?.kind === "repost");
    const authors = account.relevant.some(({ post }) => (post.relationship?.kind ?? "original") !== "repost");
    const examples = [...account.relevant]
      .sort((a, b) => b.judgment.score - a.judgment.score)
      .slice(0, 3)
      .map(({ post, judgment }) => ({
        source_url: sourceUrl(post),
        text: post.full_text.slice(0, 200),
        score: judgment.score,
        reason: judgment.reason,
      }));
    const score = account.relevant.reduce((total, entry) => total + entry.judgment.score, 0);
    const feedPosts = account.posts.filter((post) => post.feed !== "profile");
    const profilePosts = account.posts.filter((post) => post.feed === "profile");
    const consistencyPosts = feedPosts.length > 0 ? feedPosts : profilePosts;
    const consistencyRelevant = account.relevant.filter(({ post }) => consistencyPosts.includes(post)).length;
    const relevantRatio = account.posts.length > 0 ? account.relevant.length / account.posts.length : 0;
    const consistency = consistencyPosts.length > 0
      ? (consistencyRelevant + 1) / (consistencyPosts.length + 2) : 0;
    const sampleSources: Array<"feed" | "profile"> = [
      ...(feedPosts.length > 0 ? ["feed" as const] : []),
      ...(profilePosts.length > 0 ? ["profile" as const] : []),
    ];
    const uncertainty = account.posts.length < 5 || account.relevant.length < 2 ? "thin" as const
      : account.posts.length < 15 ? "moderate" as const : "low" as const;
    return {
      author_id: authorId,
      handle: handles[handles.length - 1] ?? "",
      role: curates && authors ? "both" as const : curates ? "curator" as const : "author" as const,
      posts_examined: account.posts.length,
      relevant_posts: account.relevant.length,
      relevant_ratio: relevantRatio,
      consistency,
      sample_sources: sampleSources,
      score,
      resource_links: account.links.size,
      link_examples: [...account.links].slice(0, 3).map((key) => account.linkUrls.get(key) ?? key),
      examples,
      first_seen: times[0] ?? "",
      last_seen: times[times.length - 1] ?? "",
      uncertainty,
      reason: account.relevant.length === 0
        ? "No relevant posts in the examined sample."
        : "Ranked by " + account.relevant.length + " relevant posts of " + account.posts.length
          + " (score " + score + ", ratio " + relevantRatio.toFixed(2) + ", consistency " + consistency.toFixed(2) + ")"
          + (account.links.size > 0 ? " and " + account.links.size + " distinct resource links." : "."),
      version: ACCOUNT_VERSION,
    };
  }).sort((a, b) =>
    b.consistency - a.consistency || b.relevant_ratio - a.relevant_ratio || b.score - a.score
    || b.resource_links - a.resource_links || a.handle.localeCompare(b.handle));
}
