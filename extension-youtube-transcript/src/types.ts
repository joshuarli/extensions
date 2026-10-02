import type { Effect } from "effect";
import { Schema } from "effect";
import type { CaptionFetchError, PageReadError, PlayerDataError } from "./error.ts";

export const CaptionTrackSchema = Schema.Struct({
    languageCode: Schema.String,
    kind: Schema.optional(Schema.String),
    baseUrl: Schema.optional(Schema.String),
  }),
  YouTubePlayerDataSchema = Schema.Struct({
    videoDetails: Schema.optional(Schema.Struct({ videoId: Schema.optional(Schema.String) })),
    captions: Schema.optional(
      Schema.Struct({
        playerCaptionsTracklistRenderer: Schema.optional(
          Schema.Struct({ captionTracks: Schema.optional(Schema.Array(CaptionTrackSchema)) }),
        ),
      }),
    ),
  }),
  TranscriptSegmentSchema = Schema.Struct({
    start: Schema.Number,
    text: Schema.String,
    speakerChange: Schema.optional(Schema.Boolean),
    speaker: Schema.optional(Schema.Number),
  }),
  ChapterSchema = Schema.Struct({ title: Schema.String, start: Schema.Number }),
  TranscriptPanelDataSchema = Schema.Struct({
    segments: Schema.Array(TranscriptSegmentSchema),
    languageCode: Schema.optional(Schema.String),
  }),
  TranscriptResultSchema = Schema.Struct({
    text: Schema.String,
    srt: Schema.String,
    languageCode: Schema.optional(Schema.String),
  }),
  PageMetadataSchema = Schema.Struct({
    title: Schema.optional(Schema.String),
    author: Schema.optional(Schema.String),
    published: Schema.optional(Schema.String),
    source: Schema.optional(Schema.String),
    image: Schema.optional(Schema.String),
    site: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    language: Schema.optional(Schema.String),
  }),
  PageDataSchema = Schema.Struct({
    playerResponse: Schema.Unknown,
    initialData: Schema.Unknown,
    metadata: PageMetadataSchema,
    transcript: Schema.NullOr(TranscriptPanelDataSchema),
  }),
  PreferredLanguageSettingsSchema = Schema.Struct({ language: Schema.String });

export type CaptionTrack = Schema.Schema.Type<typeof CaptionTrackSchema>;
export type YouTubePlayerData = Schema.Schema.Type<typeof YouTubePlayerDataSchema>;
export type TranscriptSegment = Schema.Schema.Type<typeof TranscriptSegmentSchema>;
export type Chapter = Schema.Schema.Type<typeof ChapterSchema>;
export type TranscriptPanelData = Schema.Schema.Type<typeof TranscriptPanelDataSchema>;
export type TranscriptResult = Schema.Schema.Type<typeof TranscriptResultSchema>;
export type PageMetadata = Schema.Schema.Type<typeof PageMetadataSchema>;
export type PageData = Schema.Schema.Type<typeof PageDataSchema>;
export type PreferredLanguageSettings = Schema.Schema.Type<typeof PreferredLanguageSettingsSchema>;

export interface ResolveTranscriptInput {
  tabUrl: string;
  pageData: PageData;
  preferredLanguage?: string;
  fetchTranscript: (
    chapters: readonly Chapter[],
  ) => Effect.Effect<TranscriptResult | undefined, CaptionFetchError | PlayerDataError>;
  readPanel: () => Effect.Effect<TranscriptPanelData | null, PageReadError>;
}

export interface ResolveTranscriptOutput {
  metadata: PageMetadata;
  transcript: TranscriptResult;
}

export interface BackgroundDependencies {
  fetch: typeof globalThis.fetch;
  getSettings: () => Promise<unknown>;
  readPageData: (tabId: number) => Promise<unknown>;
  readPanel: (tabId: number) => Promise<unknown>;
  fetchTranscript: (
    videoId: string,
    pageData: PageData,
    preferredLanguage: string | undefined,
    chapters: readonly Chapter[],
    fetchImpl: typeof globalThis.fetch,
  ) => Effect.Effect<TranscriptResult | undefined, CaptionFetchError | PlayerDataError>;
  copy: (tabId: number, text: string) => Promise<void>;
  progress: (tabId: number, message: string, done?: boolean) => Promise<void>;
  setTitle: (tabId: number, title: string) => Promise<void>;
  notify: (title: string, message: string) => Promise<void>;
  download?: (filename: string, content: Uint8Array | string, type?: string) => Promise<void>;
  schedule: (fn: () => void, ms: number) => void;
  log: (...args: unknown[]) => void;
}

export type FetchMock = (url: string, options?: RequestInit) => Promise<Response>;
