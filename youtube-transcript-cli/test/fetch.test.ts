import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  fetchVideoTranscript,
  markdownTranscript,
} from "../../youtube-transcript-core/src/index.ts";

const fixtures = fileURLToPath(new URL("../../extension-youtube-transcript/test/fixtures/", import.meta.url));
const innertube = JSON.parse(
  gunzipSync(readFileSync(fixtures + "UH6HCSNs7Os-innertube.json.gz")).toString("utf8"),
) as Record<string, unknown>;
const captionXml = readFileSync(fixtures + "UH6HCSNs7Os-caption.xml", "utf8");

const fixtureFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/youtubei/v1/player") || url.includes("/youtubei/v1/next")) {
    return { ok: true, json: async () => innertube["playerResponse"] } as Response;
  }
  if (url.includes("/api/timedtext")) return { ok: true, text: async () => captionXml } as Response;
  throw new Error("Unexpected fixture request: " + url);
}) as typeof globalThis.fetch;

describe("fetchVideoTranscript", () => {
  it("builds a transcript and markdown from YouTube's public endpoints", async () => {
    const result = await Effect.runPromise(fetchVideoTranscript({
      url: "https://www.youtube.com/watch?v=UH6HCSNs7Os",
      fetchImpl: fixtureFetch,
    }));

    expect(result.videoId).toBe("UH6HCSNs7Os");
    expect(result.transcript.text).toContain("vortex");
    expect(result.transcript.srt).toContain("00:00:22,760");
    expect(markdownTranscript(result)).toContain("---");
  });

  it("rejects non-YouTube input", async () => {
    await expect(Effect.runPromise(fetchVideoTranscript({
      url: "https://example.com/v/abc",
      fetchImpl: fixtureFetch,
    }))).rejects.toMatchObject({ _tag: "NoTranscriptError" });
  });
});
