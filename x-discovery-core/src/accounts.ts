import type { ResourceLink } from "./links.ts";
import { sourceUrl, type DiscoveredPost } from "./post.ts";
import type { TopicJudgment } from "./topic.ts";

export const ACCOUNT_VERSION = "accounts-1";

export interface AccountExample {
  source_url: string;
  text: string;
  score: number;
  reason: string;
}

export interface AccountFinding {
  author_id: string;
  handle: string;
  role: "author" | "curator" | "both";
  posts_examined: number;
  relevant_posts: number;
  score: number;
  resource_links: number;
  link_examples: string[];
  examples: AccountExample[];
  first_seen: string;
  last_seen: string;
  uncertainty: "thin" | "moderate" | "low";
  reason: string;
  version: string;
}

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
  }>();
  for (const post of posts) {
    const account = accounts.get(post.author_id) ?? { posts: [], relevant: [], links: new Set<string>() };
    account.posts.push(post);
    const judgment = topicByTweet.get(post.tweet_id);
    if (judgment?.verdict === "relevant") account.relevant.push({ post, judgment });
    accounts.set(post.author_id, account);
  }
  for (const link of links) {
    const post = posts.find((candidate) => candidate.tweet_id === link.source_tweet_id);
    if (!post) continue;
    accounts.get(post.author_id)?.links.add(link.dedupe_key);
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
    const uncertainty = account.relevant.length < 3 ? "thin" as const
      : account.relevant.length < 10 ? "moderate" as const : "low" as const;
    return {
      author_id: authorId,
      handle: handles[handles.length - 1] ?? "",
      role: curates && authors ? "both" as const : curates ? "curator" as const : "author" as const,
      posts_examined: account.posts.length,
      relevant_posts: account.relevant.length,
      score,
      resource_links: account.links.size,
      link_examples: [...account.links].slice(0, 3),
      examples,
      first_seen: times[0] ?? "",
      last_seen: times[times.length - 1] ?? "",
      uncertainty,
      reason: account.relevant.length === 0
        ? "No relevant posts in the examined sample."
        : "Ranked by " + account.relevant.length + " relevant posts (score " + score + ")"
          + (account.links.size > 0 ? " and " + account.links.size + " distinct resource links." : "."),
      version: ACCOUNT_VERSION,
    };
  }).sort((a, b) =>
    b.relevant_posts - a.relevant_posts || b.score - a.score || b.resource_links - a.resource_links || a.handle.localeCompare(b.handle));
}
