import { Schema } from "effect";
import {
  COLLECTION_FORMAT,
  COLLECTION_VERSION,
  type CollectionState,
  type MembershipRecord,
} from "./types.ts";

const MediaRefSchema = Schema.Struct({
  url: Schema.String,
  kind: Schema.Literals(["image", "video"]),
  width: Schema.Number,
  height: Schema.Number,
});

export const PostSchema = Schema.Struct({
  shortcode: Schema.String,
  username: Schema.NullOr(Schema.String),
  postType: Schema.Literals(["image", "video", "carousel"]),
  caption: Schema.NullOr(Schema.String),
  media: Schema.Array(MediaRefSchema),
});

const MembershipRecordSchema = Schema.Struct({
  shortcode: Schema.String,
  username: Schema.NullOr(Schema.String),
  postType: Schema.Literals(["image", "video", "carousel"]),
  capturedAt: Schema.String,
  complete: Schema.Boolean,
});

const CollectionStateSchema = Schema.Struct({
  format: Schema.Literal(COLLECTION_FORMAT),
  version: Schema.Literal(COLLECTION_VERSION),
  kind: Schema.Literals(["profile", "saved"]),
  key: Schema.String,
  cursor: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
  membership: Schema.Record(Schema.String, MembershipRecordSchema),
});

export function emptyCollection(kind: "profile" | "saved", key: string): CollectionState {
  return {
    format: COLLECTION_FORMAT,
    version: COLLECTION_VERSION,
    kind,
    key,
    cursor: null,
    complete: false,
    membership: {},
  };
}

export function encodeCollection(state: CollectionState): string {
  return JSON.stringify(state, null, 2) + "\n";
}

export function decodeCollection(text: string): CollectionState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    return Schema.decodeUnknownSync(CollectionStateSchema)(value);
  } catch {
    return null;
  }
}

export function withMembership(state: CollectionState, records: readonly MembershipRecord[]): CollectionState {
  const membership = { ...state.membership };
  for (const record of records) membership[record.shortcode] = record;
  return { ...state, membership };
}
