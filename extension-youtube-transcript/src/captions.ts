import type { CaptionTrack } from "./types.ts";

function normalizeLanguageCode(code: string): string {
  return (code || "").trim().replaceAll("_", "-").toLowerCase();
}

export function pickCaptionTrack(
  tracks: CaptionTrack[],
  preferredLanguage?: string,
): CaptionTrack | undefined {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return undefined;
  }

  if (preferredLanguage) {
    const wanted = normalizeLanguageCode(preferredLanguage);
    const [base] = wanted.split("-");
    const findBest = (predicate: (code: string) => boolean): CaptionTrack | undefined => {
      const matches = tracks.filter((track) =>
        predicate(normalizeLanguageCode(track.languageCode)),
      );
      return matches.find((track) => track.kind !== "asr") || matches[0];
    };
    const exact = findBest((code) => code === wanted);
    const baseTrack = findBest((code) => code === base);
    const regional = findBest((code) => code.split("-")[0] === base);
    if (exact || baseTrack || regional) {
      return exact || baseTrack || regional;
    }
  }

  const manual = tracks.filter((track) => track.kind !== "asr");
  const pool = manual.length > 0 ? manual : tracks;
  return pool.find((track) => normalizeLanguageCode(track.languageCode) === "en") || pool[0];
}
