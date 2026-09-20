import type { CaptionTrack, Chapter, TranscriptResult } from "./types.ts";
import { CaptionFetchError } from "./error.ts";
import { extractChapters, parseTranscriptXml } from "./transcript.ts";
import { pickCaptionTrack } from "./captions.ts";

const NEXT_URL = "https://www.youtube.com/youtubei/v1/next?prettyPrint=false",
  PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
  PLAYER_CONTEXTS = [
    { clientName: "IOS", clientVersion: "20.10.3" },
    { clientName: "ANDROID", clientVersion: "20.10.38" },
    { clientName: "WEB", clientVersion: "2.20240101.00.00" },
  ],
  WEB_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
  FETCH_TIMEOUT_MS = 4000;

export function getCaptionTracks(playerData: unknown): CaptionTrack[] {
  const tracks = (playerData as Record<string, unknown>)?.["captions"] as
      | Record<string, unknown>
      | undefined,
    tracklist = tracks?.["playerCaptionsTracklistRenderer"] as Record<string, unknown> | undefined,
    captionTracks = tracklist?.["captionTracks"];
  return Array.isArray(captionTracks) ? (captionTracks as CaptionTrack[]) : [];
}

export async function fetchTranscript(
  videoId: string,
  pageData: { playerResponse: unknown },
  preferredLanguage: string | undefined,
  inlineChapters: Chapter[],
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<TranscriptResult | undefined> {
  const chaptersPromise = fetchChapters(videoId, inlineChapters, preferredLanguage, fetchImpl),
    playerVideoId = (
      (pageData.playerResponse as Record<string, unknown> | undefined)?.["videoDetails"] as
        | Record<string, unknown>
        | undefined
    )?.["videoId"] as string | undefined,
    inlineTrack =
      playerVideoId !== undefined && playerVideoId !== videoId
        ? undefined
        : pickCaptionTrack(getCaptionTracks(pageData.playerResponse), preferredLanguage),
    inlinePromise = inlineTrack?.baseUrl
      ? fetchCaptionXml(
          { ...inlineTrack, baseUrl: inlineTrack.baseUrl },
          chaptersPromise,
          preferredLanguage,
          fetchImpl,
        ).catch((error: unknown) => {
          console.warn("YouTube Transcript: inline caption fetch failed", error);
          return undefined;
        })
      : Promise.resolve(undefined),
    playerData = await fetchPlayerData(videoId, preferredLanguage, fetchImpl),
    apiTrack = pickCaptionTrack(getCaptionTracks(playerData), preferredLanguage),
    apiPromise =
      apiTrack?.baseUrl && apiTrack.baseUrl !== inlineTrack?.baseUrl
        ? fetchCaptionXml(
            { ...apiTrack, baseUrl: apiTrack.baseUrl },
            chaptersPromise,
            preferredLanguage,
            fetchImpl,
          ).catch((error: unknown) => {
            console.warn("YouTube Transcript: API caption fetch failed", error);
            return undefined;
          })
        : Promise.resolve(undefined);
  return (await apiPromise) || (await inlinePromise);
}

export async function fetchPlayerData(
  videoId: string,
  preferredLanguage: string | undefined,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<unknown> {
  for (const context of PLAYER_CONTEXTS) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (preferredLanguage) {
        headers["Accept-Language"] = preferredLanguage;
      }
      if (context.clientName === "ANDROID") {
        headers["User-Agent"] = "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";
      }
      // eslint-disable-next-line no-await-in-loop
      const response = await fetchImpl(PLAYER_URL, {
        body: JSON.stringify({ context: { client: context }, videoId }),
        headers,
        method: "POST",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const data = await response.json();
      if (getCaptionTracks(data).length > 0) {
        return data;
      }
    } catch {
      console.warn(`YouTube Transcript: player data fetch failed for ${context.clientName} client`);
    }
  }
  return undefined;
}

export async function fetchCaptionXml(
  track: CaptionTrack & { baseUrl: string },
  chaptersPromise: Promise<Chapter[]>,
  preferredLanguage: string | undefined,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<TranscriptResult | undefined> {
  const url = new URL(track.baseUrl);
  if (!url.hostname.endsWith(".youtube.com")) {
    throw new CaptionFetchError("Invalid caption URL.");
  }
  const response = await fetchImpl(track.baseUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      ...(preferredLanguage ? { "Accept-Language": preferredLanguage } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new CaptionFetchError("YouTube rejected the caption request.");
  }
  const xml = await response.text(),
    chapters = chaptersPromise ? await chaptersPromise : [];
  return parseTranscriptXml(xml, track.languageCode || "en", chapters);
}

export async function fetchChapters(
  videoId: string,
  inlineChapters: Chapter[],
  preferredLanguage: string | undefined,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Chapter[]> {
  if (inlineChapters.length > 0) {
    return inlineChapters;
  }
  try {
    const response = await fetchImpl(NEXT_URL, {
      body: JSON.stringify({ context: WEB_CONTEXT, videoId }),
      headers: {
        "Content-Type": "application/json",
        ...(preferredLanguage ? { "Accept-Language": preferredLanguage } : {}),
      },
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    return extractChapters(await response.json());
  } catch {
    console.warn("YouTube Transcript: chapter fetch failed");
    return [];
  }
}
