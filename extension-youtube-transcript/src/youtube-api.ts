import { Context, Effect, Schema } from "effect";
import { CaptionFetchError } from "./error.ts";
import { extractChapters, parseTranscriptXml } from "./transcript.ts";
import { pickCaptionTrack } from "./captions.ts";
import {
  type CaptionTrack,
  type Chapter,
  type TranscriptResult,
  YouTubePlayerDataSchema,
} from "./types.ts";

const NEXT_URL = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false",
  PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
  PLAYER_CONTEXTS = [
    { clientName: "IOS", clientVersion: "20.10.3" },
    { clientName: "ANDROID", clientVersion: "20.10.38" },
    { clientName: "WEB", clientVersion: "2.20240101.00.00" },
  ],
  WEB_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
  FETCH_TIMEOUT_MS = 4000,
  NextResponseSchema = Schema.Record(Schema.String, Schema.Unknown);

type PlayerData = Schema.Schema.Type<typeof YouTubePlayerDataSchema>;

export class YouTubeHttpClient extends Context.Service<
  YouTubeHttpClient,
  { fetch: typeof globalThis.fetch }
>()("YouTubeHttpClient") {}

export function getCaptionTracks(playerData: unknown): readonly CaptionTrack[] {
  const decoded = decodePlayerData(playerData);
  return [...(decoded?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [])];
}

export function fetchTranscript(
  videoId: string,
  pageData: { playerResponse: unknown },
  preferredLanguage: string | undefined,
  inlineChapters: readonly Chapter[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Effect.Effect<TranscriptResult | undefined, CaptionFetchError> {
  const program = Effect.gen(function* () {
    const inlineData = decodePlayerData(pageData.playerResponse),
      playerVideoId = inlineData?.videoDetails?.videoId,
      inlineTrack =
        playerVideoId !== undefined && playerVideoId !== videoId
          ? undefined
          : pickCaptionTrack(getCaptionTracks(inlineData), preferredLanguage),
      chapters = yield* fetchChapters(videoId, inlineChapters, preferredLanguage, fetchImpl),
      inlineTranscriptEffect = inlineTrack?.baseUrl
        ? fetchCaptionXml(
            { ...inlineTrack, baseUrl: inlineTrack.baseUrl },
            Effect.succeed(chapters),
            preferredLanguage,
            fetchImpl,
          ).pipe(Effect.catch(logCaptionFailure("inline")))
        : Effect.succeed(undefined),
      [playerData, inlineTranscript] = yield* Effect.all(
        [fetchPlayerData(videoId, preferredLanguage, fetchImpl), inlineTranscriptEffect],
        { concurrency: "unbounded" },
      ),
      apiTrack = pickCaptionTrack(getCaptionTracks(playerData), preferredLanguage);

    if (!apiTrack?.baseUrl || apiTrack.baseUrl === inlineTrack?.baseUrl) {
      return inlineTranscript;
    }

    const apiTranscript = yield* fetchCaptionXml(
      { ...apiTrack, baseUrl: apiTrack.baseUrl },
      Effect.succeed(chapters),
      preferredLanguage,
      fetchImpl,
    ).pipe(Effect.catch(logCaptionFailure("API")));
    return apiTranscript ?? inlineTranscript;
  });

  return Effect.provideService(program, YouTubeHttpClient, {
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
  });
}

export function fetchPlayerData(
  videoId: string,
  preferredLanguage: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Effect.Effect<unknown, never> {
  const program = Effect.gen(function* () {
    const client = yield* YouTubeHttpClient;
    for (const context of PLAYER_CONTEXTS) {
      const result = yield* Effect.tryPromise({
        try: async () => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (preferredLanguage) {
            headers["Accept-Language"] = preferredLanguage;
          }
          if (context.clientName === "ANDROID") {
            headers["User-Agent"] = "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";
          }
          const response = await client.fetch(PLAYER_URL, {
            body: JSON.stringify({ context: { client }, videoId }),
            headers,
            method: "POST",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!response.ok) return undefined;
          const rawData: unknown = await response.json(),
            data = decodePlayerData(rawData);
          return data && getCaptionTracks(data).length > 0 ? rawData : undefined;
        },
        catch: () => new CaptionFetchError("Player data request failed."),
      }).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            console.warn(
              `YouTube Transcript: player data fetch failed for ${context.clientName} client`,
            );
            return undefined;
          })
        ),
      );
      if (result) return result;
    }
    return undefined;
  });

  return Effect.provideService(program, YouTubeHttpClient, {
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
  });
}

export function fetchCaptionXml(
  track: CaptionTrack & { baseUrl: string },
  chapters: Effect.Effect<readonly Chapter[], CaptionFetchError>,
  preferredLanguage: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Effect.Effect<TranscriptResult | undefined, CaptionFetchError> {
  const program = Effect.gen(function* () {
    const result = yield* fetchCaptionXmlText(track.baseUrl, preferredLanguage, fetchImpl),
      chapterList = yield* chapters;
    return parseTranscriptXml(result, track.languageCode || "en", chapterList);
  });

  return Effect.provideService(program, YouTubeHttpClient, {
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
  });
}

export function fetchCaptionXmlText(
  baseUrl: string,
  preferredLanguage: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Effect.Effect<string, CaptionFetchError> {
  const program = Effect.gen(function* () {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return yield* Effect.fail(new CaptionFetchError("Invalid caption URL."));
    }
    if (!url.hostname.endsWith(".youtube.com")) {
      return yield* Effect.fail(new CaptionFetchError("Invalid caption URL."));
    }

    const client = yield* YouTubeHttpClient;
    return yield* Effect.tryPromise({
      try: async () => {
        const response = await client.fetch(baseUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            ...(preferredLanguage ? { "Accept-Language": preferredLanguage } : {}),
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new CaptionFetchError("YouTube rejected the caption request.");
        }
        return await response.text();
      },
      catch: (cause) =>
        cause instanceof CaptionFetchError
          ? cause
          : new CaptionFetchError("Could not download captions from YouTube."),
    });
  });

  return Effect.provideService(program, YouTubeHttpClient, {
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
  });
}

export function fetchNextResponse(
  videoId: string,
  preferredLanguage: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Effect.Effect<Record<string, unknown>, CaptionFetchError> {
  const program = Effect.gen(function* () {
    const client = yield* YouTubeHttpClient;
    return yield* Effect.tryPromise({
      try: async () => {
        const response = await client.fetch(NEXT_URL, {
          body: JSON.stringify({ context: WEB_CONTEXT, videoId }),
          headers: {
            "Content-Type": "application/json",
            ...(preferredLanguage ? { "Accept-Language": preferredLanguage } : {}),
          },
          method: "POST",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return {};
        const rawData: unknown = await response.json();
        return Schema.decodeUnknownSync(NextResponseSchema)(rawData);
      },
      catch: () => new CaptionFetchError("Could not load transcript chapters."),
    });
  });

  return Effect.provideService(program, YouTubeHttpClient, {
    fetch: fetchImpl ?? globalThis.fetch.bind(globalThis),
  });
}

export function fetchChapters(
  videoId: string,
  inlineChapters: readonly Chapter[],
  preferredLanguage: string | undefined,
  fetchImpl?: typeof globalThis.fetch,
): Effect.Effect<readonly Chapter[], CaptionFetchError> {
  if (inlineChapters.length > 0) return Effect.succeed([...inlineChapters]);
  return fetchNextResponse(videoId, preferredLanguage, fetchImpl).pipe(
    Effect.map(extractChapters),
    Effect.catch(() =>
      Effect.sync(() => {
        console.warn("YouTube Transcript: chapter fetch failed");
        return [];
      })
    ),
  );
}

function decodePlayerData(input: unknown): PlayerData | undefined {
  try {
    return Schema.decodeUnknownSync(YouTubePlayerDataSchema)(input);
  } catch {
    return undefined;
  }
}

function logCaptionFailure(source: string) {
  return (error: CaptionFetchError): Effect.Effect<undefined> =>
    Effect.sync(() => {
      console.warn(`YouTube Transcript: ${source} caption fetch failed`, error);
      return undefined;
    });
}
