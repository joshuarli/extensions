import type { Chapter, TranscriptResult, TranscriptSegment } from "./types.ts";
import { buildSrt } from "./srt.ts";

const CJK_CHAR_RANGES = String.raw`\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff`;
const CJK_SENTENCE_PUNCT = String.raw`\u3002\uff01\uff1f`;
const CJK_CLOSE_QUOTES = String.raw`\u300d\u300f\uff09`;
const SENTENCE_END = new RegExp(
  `[.!?${CJK_SENTENCE_PUNCT}]["'\\u2019\\u201d)${CJK_CLOSE_QUOTES}]*\\s*$`,
  "u",
);
const QUESTION_END = new RegExp(`[?\\uff1f]["'\\u2019\\u201d)${CJK_CLOSE_QUOTES}]*\\s*$`, "u");
const SPEAKER_MARKER = /^(>>|-\s)/u;
const SPEAKER_STRIP = /^(>>\s*|-\s+)/u;
const TRAILING_COMMA = /,\s*$/u;
const TRANSCRIPT_GROUP_GAP_SECONDS = 20;
const TRANSCRIPT_MAX_GROUP_SECONDS = 30;
const TURN_MERGE_MAX_WORDS = 80;
const TURN_MERGE_MAX_SPAN_SECONDS = 45;
const SHORT_UTTERANCE_MAX_WORDS = 3;
const FIRST_GROUP_MERGE_MIN_WORDS = 8;
const AFFIRMATIVE_PATTERN =
  /^(mhm|yeah|yes|yep|right|okay|ok|absolutely|sure|exactly|uh-huh|mm-hmm)[.!,]?\s+/iu;

function countWords(text: string): number {
  const cjk = (text.match(new RegExp(`[${CJK_CHAR_RANGES}]`, "gu")) || []).length;
  const latin = text
    .replaceAll(new RegExp(`[${CJK_CHAR_RANGES}]`, "gu"), " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
  return cjk + latin;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function buildTranscript(
  segments: TranscriptSegment[],
  chapters: Chapter[] = [],
): TranscriptResult {
  const sortedChapters = [...chapters].toSorted((a, b) => a.start - b.start);
  let chapterIndex = 0;
  const text = [];

  for (const segment of segments) {
    while (chapterIndex < sortedChapters.length) {
      const chapter = sortedChapters[chapterIndex];
      if (!chapter || chapter.start > segment.start) {
        break;
      }
      chapterIndex++;
      if (text.length > 0) {
        text.push("");
      }
      text.push(`### ${chapter.title}`, "");
    }

    const timestamp = formatTimestamp(segment.start);
    if (segment.speakerChange && text.length > 0) {
      text.push("");
    }
    text.push(`**${timestamp}** · ${segment.text}`);
  }

  return {
    text: text.join("\n"),
    srt: buildSrt(segments),
  };
}

export function groupTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length === 0) {
    return [];
  }
  return segments.some((segment) => SPEAKER_MARKER.test(segment.text))
    ? groupBySpeaker(segments)
    : groupBySentence(segments);
}

function groupBySentence(segments: TranscriptSegment[]): TranscriptSegment[] {
  const groups: TranscriptSegment[] = [];
  const pending: TranscriptSegment[] = [];
  const flush = (count?: number): void => {
    const selected = count === undefined ? pending.splice(0) : pending.splice(0, count);
    const text = selected
      .map((segment) => segment.text)
      .join(" ")
      .trim();
    if (text) {
      const first = selected[0];
      if (first) {
        groups.push({ speakerChange: false, start: first.start, text });
      }
    }
  };

  for (const segment of segments) {
    const lastPending = pending.at(-1);
    if (lastPending && segment.start - lastPending.start > TRANSCRIPT_GROUP_GAP_SECONDS) {
      flush();
    }
    pending.push(segment);
    if (SENTENCE_END.test(segment.text)) {
      flush();
      continue;
    }
    const firstPending = pending[0];
    if (firstPending && segment.start - firstPending.start >= TRANSCRIPT_MAX_GROUP_SECONDS) {
      const index = findNaturalBreak(pending);
      if (index > 0 && index < pending.length) {
        flush(index);
      } else {
        flush();
      }
    }
  }
  flush();
  return groups;
}

function findNaturalBreak(segments: TranscriptSegment[]): number {
  if (segments.length <= 1) {
    return -1;
  }
  const first = segments[0];
  if (!first) {
    return -1;
  }
  const minStart = first.start + TRANSCRIPT_MAX_GROUP_SECONDS / 2;
  const boundary = new RegExp(
    `^(.*[.!?]["'\\u2019\\u201d)]*)\\s+([A-Z].*)$|^(.*[${CJK_SENTENCE_PUNCT}][${CJK_CLOSE_QUOTES}]*)([${CJK_CHAR_RANGES}].*)$`,
    "u",
  );
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }
    if (segment.start < minStart) {
      break;
    }
    const match = segment.text.match(boundary);
    if (!match) {
      continue;
    }
    const before = (match[1] || match[3])!;
    const after = (match[2] || match[4])!;
    segments.splice(
      i,
      1,
      { start: segment.start, text: before },
      { start: segment.start, text: after },
    );
    return i + 1;
  }
  let bestIndex = -1;
  let bestGap = 0;
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const previous = segments[i - 1];
    if (!segment || !previous) {
      continue;
    }
    if (segment.start < minStart) {
      continue;
    }
    const gap = segment.start - previous.start;
    if (gap >= bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function isShortStandaloneUtterance(text: string): boolean {
  return (
    countWords(text) > 0 && countWords(text) <= SHORT_UTTERANCE_MAX_WORDS && SENTENCE_END.test(text)
  );
}

function shouldMerge(current: TranscriptSegment, next: TranscriptSegment, first: boolean): boolean {
  if (isShortStandaloneUtterance(current.text) || isShortStandaloneUtterance(next.text)) {
    return false;
  }
  if (first && countWords(current.text) < FIRST_GROUP_MERGE_MIN_WORDS) {
    return false;
  }
  if (QUESTION_END.test(current.text) || QUESTION_END.test(next.text)) {
    return false;
  }
  if (countWords(current.text) + countWords(next.text) > TURN_MERGE_MAX_WORDS) {
    return false;
  }
  return next.start - current.start <= TURN_MERGE_MAX_SPAN_SECONDS;
}

function mergeSentenceGroups(groups: TranscriptSegment[]): TranscriptSegment[] {
  if (groups.length <= 1) {
    return groups;
  }
  const firstGroup = groups[0];
  if (!firstGroup) {
    return [];
  }
  const merged = [{ ...firstGroup }];
  let isFirst = true;
  for (const next of groups.slice(1)) {
    const current = merged.at(-1);
    if (!current) {
      continue;
    }
    if (shouldMerge(current, next, isFirst)) {
      current.text += ` ${next.text}`;
    } else {
      merged.push({ ...next });
      isFirst = false;
    }
  }
  return merged;
}

interface SpeakerTurn {
  start: number;
  segments: TranscriptSegment[];
  speakerChange: boolean;
  speaker?: number;
}

function groupBySpeaker(segments: TranscriptSegment[]): TranscriptSegment[] {
  const turns: SpeakerTurn[] = [];
  let current: SpeakerTurn | null = null;
  let speaker = -1;
  let previousText = "";

  for (const segment of segments) {
    const marker = SPEAKER_MARKER.test(segment.text);
    const cleanText = segment.text.replace(SPEAKER_STRIP, "");
    const realChange =
      marker &&
      (SENTENCE_END.test(previousText) || !previousText) &&
      !TRAILING_COMMA.test(previousText);
    if (realChange) {
      if (current) {
        turns.push(current);
      }
      speaker = (speaker + 1) % 2;
      current = {
        segments: [{ start: segment.start, text: cleanText }],
        speaker,
        speakerChange: true,
        start: segment.start,
      };
    } else {
      if (!current) {
        current = { segments: [], speakerChange: false, start: segment.start };
      }
      current.segments.push({ start: segment.start, text: cleanText });
    }
    previousText = cleanText;
  }
  if (current) {
    turns.push(current);
  }

  splitAffirmativeTurns(turns);

  const groups: TranscriptSegment[] = [];
  for (const turn of turns) {
    const split =
      turn.speaker === undefined
        ? groupBySentence(turn.segments)
        : mergeSentenceGroups(groupBySentence(turn.segments));
    split.forEach((group, index) => {
      groups.push({
        ...group,
        ...(turn.speaker === undefined ? {} : { speaker: turn.speaker }),
        speakerChange: index === 0 && turn.speakerChange,
      });
    });
  }
  return groups;
}

function splitAffirmativeTurns(turns: SpeakerTurn[]): void {
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    if (!turn || turn.speaker === undefined || turn.segments.length === 0) {
      continue;
    }

    const [firstSegment] = turn.segments;
    if (!firstSegment) {
      continue;
    }
    const match = firstSegment.text.match(AFFIRMATIVE_PATTERN);
    if (!match || /,\s*$/u.test(match[0])) {
      continue;
    }

    const remainder = firstSegment.text.slice(match[0].length).trim();
    const restSegments = turn.segments.slice(1);
    const restWords =
      countWords(remainder) +
      restSegments.reduce((sum, segment) => sum + countWords(segment.text), 0);
    if (restWords < 30) {
      continue;
    }

    const affirmativeTurn: SpeakerTurn = {
      segments: [{ start: firstSegment.start, text: match[0].trimEnd() }],
      speaker: turn.speaker,
      speakerChange: turn.speakerChange,
      start: turn.start,
    };
    const newRestSegments = remainder
      ? [{ start: firstSegment.start, text: remainder }, ...restSegments]
      : restSegments;
    const firstRestSegment = newRestSegments[0];
    if (!firstRestSegment) {
      continue;
    }
    const restTurn: SpeakerTurn = {
      segments: newRestSegments,
      speaker: turn.speaker === 0 ? 1 : 0,
      speakerChange: true,
      start: firstRestSegment.start,
    };
    turns.splice(index, 1, affirmativeTurn, restTurn);
    index++;
  }
}

export function extractChapters(data: unknown): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  const add = (title: string | undefined, start: number | null): void => {
    if (!title || typeof start !== "number" || !Number.isFinite(start)) {
      return;
    }
    const key = `${start}\u0000${title}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    chapters.push({ start, title });
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        visit(v);
      }
      return;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj["chapters"])) {
      for (const item of obj["chapters"]) {
        const chapter = (item as Record<string, unknown>)["chapterRenderer"] as
          | Record<string, unknown>
          | undefined;
        add(
          (chapter?.["title"] as Record<string, unknown> | undefined)?.["simpleText"] as
            | string
            | undefined,
          (chapter?.["timeRangeStartMillis"] as number) / 1000,
        );
      }
    }
    const marker = obj["macroMarkersListItemRenderer"] as Record<string, unknown> | undefined;
    if (marker) {
      add(
        (marker["title"] as Record<string, unknown> | undefined)?.["simpleText"] as
          | string
          | undefined,
        parseTimestampValue(
          ((marker["timeDescription"] as Record<string, unknown> | undefined)?.[
            "simpleText"
          ] as string) || "",
        ),
      );
    }
    for (const v of Object.values(obj)) {
      visit(v);
    }
  };
  visit(data);
  return chapters.toSorted((a, b) => a.start - b.start);
}

function parseTimestampValue(value: string): number | null {
  const parts = value
    .trim()
    .split(":")
    .map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n)) || (parts.length !== 2 && parts.length !== 3)) {
    return null;
  }
  const [first = 0, second = 0, third = 0] = parts;
  return parts.length === 3 ? first * 3600 + second * 60 + third : first * 60 + second;
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll(/&#x([0-9a-fA-F]+);/gu, (_, hex) => String.fromCodePoint(Number(`0x${hex}`)))
    .replaceAll(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Math.trunc(Number(decimal))));
}

export function parseTranscriptXml(
  xml: string,
  languageCode?: string,
  chapters: Chapter[] = [],
): TranscriptResult | undefined {
  const segments = [];
  const pRegex = /<p\s+t="(\d+)"[^>]*>([\s\S]*?)<\/p>/gu;
  let match;
  while ((match = pRegex.exec(xml))) {
    const inner = match[2];
    const start = match[1];
    if (inner === undefined || start === undefined) {
      continue;
    }
    const pieces = [...inner.matchAll(/<s[^>]*>([^<]*)<\/s>/gu)].map((item) => item[1] ?? "");
    let text = pieces.length > 0 ? pieces.join("") : inner.replaceAll(/<[^>]+>/gu, "");
    text = decodeEntities(text.replaceAll("\n", " ").replaceAll(/\s{2,}/gu, " ")).trim();
    if (text) {
        segments.push({ start: Math.trunc(Number(start)) / 1000, text });
    }
  }
  if (segments.length === 0) {
    const textRegex = /<text\s+start="([^"]*)"[^>]*>([\s\S]*?)<\/text>/gu;
    while ((match = textRegex.exec(xml))) {
      const start = match[1];
      const content = match[2];
      if (start === undefined || content === undefined) {
        continue;
      }
      const text = decodeEntities(
        content
          .replaceAll(/<[^>]+>/gu, "")
          .replaceAll("\n", " ")
          .replaceAll(/\s{2,}/gu, " "),
      ).trim();
      if (text) {
        segments.push({ start: Number(start), text });
      }
    }
  }
  if (segments.length === 0) {
    return undefined;
  }
  return {
    ...buildTranscript(groupTranscriptSegments(segments), chapters),
    ...(languageCode === undefined ? {} : { languageCode }),
  };
}
