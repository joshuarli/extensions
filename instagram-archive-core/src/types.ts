import { Schema } from "effect";

export const COLLECTION_FORMAT = "instagram-archive-collection";
export const COLLECTION_VERSION = 1;

export const MediaKindSchema = Schema.Literals(["image", "video"]);
export type MediaKind = Schema.Schema.Type<typeof MediaKindSchema>;
export const PostTypeSchema = Schema.Literals(["image", "video", "carousel"]);
export type PostType = Schema.Schema.Type<typeof PostTypeSchema>;
export type CollectionKind = "profile" | "saved";

export const MediaRefSchema = Schema.Struct({
  url: Schema.String,
  kind: MediaKindSchema,
  width: Schema.Number,
  height: Schema.Number,
});
export type MediaRef = Schema.Schema.Type<typeof MediaRefSchema>;

export const PostSchema = Schema.Struct({
  shortcode: Schema.String,
  username: Schema.NullOr(Schema.String),
  postType: PostTypeSchema,
  caption: Schema.NullOr(Schema.String),
  media: Schema.Array(MediaRefSchema),
});
export type Post = Schema.Schema.Type<typeof PostSchema>;

export interface MembershipRecord {
  readonly shortcode: string;
  readonly username: string | null;
  readonly postType: PostType;
  readonly capturedAt: string;
  readonly complete: boolean;
}

export interface CollectionState {
  readonly format: typeof COLLECTION_FORMAT;
  readonly version: typeof COLLECTION_VERSION;
  readonly kind: CollectionKind;
  readonly key: string;
  readonly cursor: string | null;
  readonly complete: boolean;
  readonly membership: Readonly<Record<string, MembershipRecord>>;
}

export interface ArchiveManifest {
  readonly format: "instagram-archive";
  readonly version: 1;
  readonly accountId: string;
  readonly createdAt: string;
  readonly collections: readonly string[];
  readonly posts: number;
  readonly media: number;
}
