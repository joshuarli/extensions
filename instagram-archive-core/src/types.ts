export const COLLECTION_FORMAT = "instagram-archive-collection";
export const COLLECTION_VERSION = 1;

export type PostType = "image" | "video" | "carousel";
export type MediaKind = "image" | "video";
export type CollectionKind = "profile" | "saved";

export interface MediaRef {
  readonly url: string;
  readonly kind: MediaKind;
  readonly width: number;
  readonly height: number;
}

export interface Post {
  readonly shortcode: string;
  readonly username: string | null;
  readonly postType: PostType;
  readonly caption: string | null;
  readonly media: readonly MediaRef[];
}

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
