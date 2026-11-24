import { Effect, Schema } from "effect";
import type {
  Chapter,
  ResolveTranscriptInput,
  ResolveTranscriptOutput,
  TranscriptPanelData,
  TranscriptResult,
} from "./types.ts";
import { buildTranscript, extractChapters, groupTranscriptSegments } from "./transcript.ts";
import { NoTranscriptError, PageReadError } from "./error.ts";
import { YouTubePlayerDataSchema } from "./types.ts";

export function resolveTranscript({
  tabUrl,
  pageData,
  preferredLanguage,
  fetchTranscript,
  readPanel,
}: ResolveTranscriptInput): Effect.Effect<
  ResolveTranscriptOutput,
  NoTranscriptError | PageReadError
> {
  return Effect.gen(function* () {
    const dataIsStale = isPlayerResponseStale(pageData.playerResponse, tabUrl),
      pageTranscript = dataIsStale ? null : pageData.transcript,
      chapters = dataIsStale ? [] : extractChapters(pageData.initialData),
      attempted: string[] = [];
    let transcript: TranscriptResult | undefined;

    if (!preferredLanguage && pageTranscript) {
      attempted.push("page transcript panel");
      transcript = formatSegments(pageTranscript, chapters);
    }
    if (!transcript) {
      attempted.push("InnerTube API");
      transcript = yield* fetchTranscript(chapters).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            attempted[attempted.length - 1] = `InnerTube API (failed: ${error.message})`;
            return undefined;
          })
        ),
      );
    }
    if (!transcript) {
      attempted.push("DOM transcript panel");
      const panelData = yield* readPanel();
      if (panelData) {
        transcript = formatSegments(panelData, chapters);
      }
    }
    if (!transcript?.text) {
      return yield* Effect.fail(
        new NoTranscriptError(tabUrl, attempted, {
          language: preferredLanguage || pageData.metadata.language,
          panelWasOpen: pageTranscript !== null,
          ...(transcript === undefined
            ? { cause: new Error("All transcript sources returned no data.") }
            : {}),
        }),
      );
    }
    const language = transcript.languageCode || pageData.metadata.language;
    return {
      metadata: {
        ...pageData.metadata,
        ...(language === undefined ? {} : { language }),
        source: tabUrl,
      },
      transcript,
    };
  });
}

function getVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1).split("/")[0] || "";
    }
    if (parsed.pathname.includes("/shorts/")) {
      return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
    }
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function isPlayerResponseStale(playerResponse: unknown, tabUrl: string): boolean {
  if (!playerResponse) return false;
  const currentVideoId = getVideoId(tabUrl);
  if (!currentVideoId) return false;
  const pageVideoId = decodePlayerVideoId(playerResponse);
  return Boolean(pageVideoId) && pageVideoId !== currentVideoId;
}

function decodePlayerVideoId(input: unknown): string | undefined {
  try {
    return Schema.decodeUnknownSync(YouTubePlayerDataSchema)(input).videoDetails?.videoId;
  } catch {
    return undefined;
  }
}

function formatSegments(
  data: TranscriptPanelData,
  chapters: readonly Chapter[],
): TranscriptResult {
  return {
    ...buildTranscript(groupTranscriptSegments([...data.segments]), [...chapters]),
    ...(data.languageCode ? { languageCode: data.languageCode } : {}),
  };
}
