import { Schema } from "effect";

export const LinkSchema = Schema.Struct({
  url: Schema.String,
  display_url: Schema.String,
});

export type Link = Schema.Schema.Type<typeof LinkSchema>;

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
  observed_at: Schema.String,
});

export type DiscoveredPost = Schema.Schema.Type<typeof DiscoveredPostSchema>;
