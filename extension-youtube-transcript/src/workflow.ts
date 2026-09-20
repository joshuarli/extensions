import type {
  Chapter,
  ResolveTranscriptInput,
  ResolveTranscriptOutput,
  TranscriptPanelData,
  TranscriptResult,
} from "./types.ts";
import { buildTranscript, extractChapters, groupTranscriptSegments } from "./transcript.ts";
import { NoTranscriptError } from "./error.ts";

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
  const pageVideoId = (
    (playerResponse as Record<string, unknown>)?.["videoDetails"] as
      | Record<string, unknown>
      | undefined
  )?.["videoId"] as string | undefined;
  return Boolean(pageVideoId) && pageVideoId !== currentVideoId;
}

export async function resolveTranscript({
  tabUrl,
  pageData,
  preferredLanguage,
  fetchTranscript,
  readPanel,
}: ResolveTranscriptInput): Promise<ResolveTranscriptOutput> {
  const dataIsStale = isPlayerResponseStale(pageData.playerResponse, tabUrl);
  if (dataIsStale) pageData.transcript = null;
  const chapters = dataIsStale ? [] : extractChapters(pageData.initialData);

  const attempted: string[] = [];
  let transcript: TranscriptResult | undefined;

  if (!preferredLanguage && pageData.transcript) {
    attempted.push("page transcript panel");
    transcript = formatSegments(pageData.transcript, chapters);
  }
  if (!transcript) {
    attempted.push("InnerTube API");
    try {
      transcript = await fetchTranscript(chapters);
    } catch (error) {
      attempted[attempted.length - 1] = `InnerTube API (failed: ${(error as Error).message})`;
    }
  }
  if (!transcript) {
    attempted.push("DOM transcript panel");
    const panelData = await readPanel();
    if (panelData) {
      transcript = formatSegments(panelData, chapters);
    }
  }
  if (!transcript?.text) {
    throw new NoTranscriptError(tabUrl, attempted, {
      language: preferredLanguage || pageData.metadata.language,
      panelWasOpen: pageData.transcript !== null,
      ...(transcript === undefined
        ? { cause: new Error("All transcript sources returned no data.") }
        : {}),
    });
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
}

function formatSegments(data: TranscriptPanelData, chapters: Chapter[]): TranscriptResult {
  return {
    ...buildTranscript(groupTranscriptSegments(data.segments), chapters),
    ...(data.languageCode ? { languageCode: data.languageCode } : {}),
  };
}
