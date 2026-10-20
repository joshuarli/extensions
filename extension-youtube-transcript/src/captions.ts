import type { CaptionTrack, YouTubePlayerData } from "./types.ts";

function normalizeLanguageCode(code: string): string {
  return (code || "").trim().replaceAll("_", "-").toLowerCase();
}

export function pickCaptionTrack(
  tracks: readonly CaptionTrack[],
  preferredLanguage?: string,
  playerData?: YouTubePlayerData,
): CaptionTrack | undefined {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return undefined;
  }

  if (preferredLanguage) {
    const wanted = normalizeLanguageCode(preferredLanguage),
      [base] = wanted.split("-"),
      findBest = (predicate: (code: string) => boolean): CaptionTrack | undefined => {
        const matches = tracks.filter((track) =>
          predicate(normalizeLanguageCode(track.languageCode)),
        );
        return matches.find((track) => track.kind !== "asr") || matches[0];
      },
      exact = findBest((code) => code === wanted),
      baseTrack = findBest((code) => code === base),
      regional = findBest((code) => code.split("-")[0] === base);
    if (exact || baseTrack || regional) {
      return exact || baseTrack || regional;
    }
  }

  const renderer = playerData?.captions?.playerCaptionsTracklistRenderer,
    audioTracks = renderer?.audioTracks ?? [],
    validIndex = (value: unknown, length: number): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length,
    defaultAudioTrack = validIndex(renderer?.defaultAudioTrackIndex, audioTracks.length)
      ? audioTracks[renderer!.defaultAudioTrackIndex as number]
      : audioTracks.length === 1
        ? audioTracks[0]
        : undefined,
    explicitAudioTrack = defaultAudioTrack ?? audioTracks[0],
    defaultCaptionIndex = [
      explicitAudioTrack?.defaultCaptionTrackIndex,
      renderer?.defaultCaptionTrackIndex,
    ].find((value) => validIndex(value, tracks.length));
  if (typeof defaultCaptionIndex === "number") {
    return tracks[defaultCaptionIndex];
  }

  const findByLanguage = (
    candidates: readonly CaptionTrack[],
    language: string | undefined,
  ): CaptionTrack | undefined => {
    if (!language) return undefined;
    const wanted = normalizeLanguageCode(language),
      base = wanted.split("-")[0],
      findBest = (predicate: (code: string) => boolean): CaptionTrack | undefined => {
        const matches = candidates.filter((track) =>
          predicate(normalizeLanguageCode(track.languageCode)),
        );
        return matches.find((track) => track.kind !== "asr") || matches[0];
      };
    return findBest((code) => code === wanted)
      || findBest((code) => code === base)
      || findBest((code) => code.split("-")[0] === base);
  };
  const defaultAudioLanguage = defaultAudioTrack?.audioTrackId?.split(".")[0],
    manual = tracks.filter((track) => track.kind !== "asr"),
    defaultAudioCaption = findByLanguage(manual, defaultAudioLanguage)
      || findByLanguage(tracks, defaultAudioLanguage);
  if (defaultAudioCaption) return defaultAudioCaption;

  const associatedTracks = (defaultAudioTrack?.captionTrackIndices ?? [])
      .filter((index) => validIndex(index, tracks.length))
      .map((index) => tracks[index])
      .filter((track): track is CaptionTrack => track !== undefined),
    asrTrack = associatedTracks.find((track) => track.kind === "asr")
      || tracks.find((track) => track.kind === "asr"),
    originalLanguage = asrTrack ? normalizeLanguageCode(asrTrack.languageCode).split("-")[0] : "",
    manualOriginal = manual.find((track) =>
      normalizeLanguageCode(track.languageCode).split("-")[0] === originalLanguage,
    );
  if (manualOriginal || asrTrack) return manualOriginal || asrTrack;

  const pool = manual.length > 0 ? manual : tracks;
  return pool.find((track) => normalizeLanguageCode(track.languageCode).split("-")[0] === "en")
    || pool[0];
}
