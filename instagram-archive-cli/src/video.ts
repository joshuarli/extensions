import { spawnSync } from "node:child_process";
import type { ArchiveFs } from "./fs.ts";

export interface MuxResult {
  readonly ok: boolean;
  readonly error: string | null;
}

export function muxVideoAudio(
  fs: ArchiveFs,
  videoPart: string,
  audioPart: string,
  outputPath: string,
): MuxResult {
  const target = outputPath + ".mux.part";
  fs.remove(target);
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", videoPart,
    "-i", audioPart,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    "-movflags", "+faststart",
    target,
  ], { encoding: "utf8", timeout: 300_000 });
  if (result.error !== undefined || result.status !== 0 || !fs.exists(target)) {
    fs.remove(target);
    return {
      ok: false,
      error: (result.stderr?.trim() || result.error?.message || "ffmpeg failed").slice(0, 300),
    };
  }
  try {
    fs.rename(target, outputPath);
  } catch (error) {
    fs.remove(target);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, error: null };
}
