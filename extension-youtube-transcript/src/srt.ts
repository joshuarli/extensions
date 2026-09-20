import type { TranscriptSegment } from "./types.ts";

export function formatSrtTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60),
    ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrt(segments: TranscriptSegment[]): string {
  const cues: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) {
      continue;
    }
    const end = segments[i + 1]?.start ?? seg.start + 5;
    cues.push(
      `${i + 1}\n${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(end)}\n${seg.text}`,
    );
  }
  return `${cues.join("\n\n")}\n`;
}
