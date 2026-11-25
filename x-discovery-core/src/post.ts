import { Schema } from "effect";

export const LinkSchema = Schema.Struct({
  url: Schema.String,
  display_url: Schema.String,
});

export type Link = Schema.Schema.Type<typeof LinkSchema>;

export const PostRelationshipSchema = Schema.Struct({
  kind: Schema.Literals(["original", "repost", "quote", "reply"]),
  source_tweet_id: Schema.NullOr(Schema.String),
  source_handle: Schema.NullOr(Schema.String),
});

export type PostRelationship = Schema.Schema.Type<typeof PostRelationshipSchema>;

export const DiscoveredPostSchema = Schema.Struct({
  tweet_id: Schema.String,
  author_id: Schema.String,
  author_handle: Schema.String,
  author_name: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  full_text: Schema.String,
  lang: Schema.String,
  urls: Schema.Array(LinkSchema),
  favorite_count: Schema.Number,
  retweet_count: Schema.Number,
  relationship: Schema.optional(PostRelationshipSchema),
  entry_id: Schema.optional(Schema.String),
  observed_at: Schema.String,
});

export type DiscoveredPost = Schema.Schema.Type<typeof DiscoveredPostSchema>;

export function sourceUrl(post: DiscoveredPost): string {
  return "https://x.com/" + post.author_handle + "/status/" + post.tweet_id;
}
