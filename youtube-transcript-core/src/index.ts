import { Effect } from "effect";
import { CaptionFetchError, NoTranscriptError } from "./error.ts";
import { buildMarkdown } from "./metadata.ts";
import type { PageMetadata, TranscriptResult } from "./types.ts";
import { getVideoId, isYouTubeUrl } from "./url.ts";
import { fetchPlayerData, fetchTranscript } from "./youtube-api.ts";

export interface FetchVideoTranscriptInput {
  readonly url: string;
  readonly language?: string | undefined;
  readonly fetchImpl?: typeof globalThis.fetch | undefined;
}

export interface VideoTranscript {
  readonly videoId: string;
  readonly metadata: PageMetadata;
  readonly transcript: TranscriptResult;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function metadataFromPlayer(playerResponse: unknown, source: string, language?: string): PageMetadata {
  const player = record(playerResponse),
    details = record(player["videoDetails"]),
    microformat = record(player["microformat"]),
    renderer = record(microformat["playerMicroformatRenderer"]);
  return {
    title: text(details["title"]),
    author: text(details["author"]),
    description: text(details["shortDescription"]),
    published: text(renderer["publishDate"]),
    source,
    site: "YouTube",
    ...(language ? { language } : {}),
  };
}

export function fetchVideoTranscript(
  input: FetchVideoTranscriptInput,
): Effect.Effect<VideoTranscript, NoTranscriptError | CaptionFetchError> {
  return Effect.gen(function* () {
    if (!isYouTubeUrl(input.url)) {
      return yield* Effect.fail(new NoTranscriptError(input.url, ["valid YouTube URL"]));
    }
    const videoId = getVideoId(input.url);
    if (!videoId) {
      return yield* Effect.fail(new NoTranscriptError(input.url, ["video id"]));
    }
    const playerResponse = yield* fetchPlayerData(videoId, input.language, input.fetchImpl);
    if (!playerResponse) {
      return yield* Effect.fail(new NoTranscriptError(input.url, ["InnerTube player data"], { language: input.language }));
    }
    const transcript = yield* fetchTranscript(
      videoId,
      { playerResponse },
      input.language,
      [],
      input.fetchImpl,
    );
    if (!transcript?.text) {
      return yield* Effect.fail(new NoTranscriptError(input.url, ["caption tracks"], { language: input.language }));
    }
    return {
      videoId,
      metadata: metadataFromPlayer(playerResponse, input.url, input.language),
      transcript,
    };
  });
}

export function markdownTranscript(result: VideoTranscript): string {
  return buildMarkdown(result.metadata, result.transcript.text);
}

export { buildMarkdown } from "./metadata.ts";
export { buildSrt } from "./srt.ts";
export { getVideoId, isYouTubeUrl } from "./url.ts";
export type { PageMetadata, TranscriptResult } from "./types.ts";
