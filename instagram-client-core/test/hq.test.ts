import { describe, expect, it } from "vitest";
import { parseDashTracks, shortcodeToMediaId } from "../src/hq.ts";

const MANIFEST = `<?xml version="1.0"?>
<MPD>
  <AdaptationSet contentType="video">
    <Representation id="1" bandwidth="1000" width="720" height="1280" codecs="avc1.4d401f">
      <BaseURL>https://cdn/video-720.mp4</BaseURL>
    </Representation>
    <Representation id="2" bandwidth="4000" width="1080" height="1920" codecs="avc1.640028">
      <BaseURL>https://cdn/video-1080.mp4</BaseURL>
    </Representation>
  </AdaptationSet>
  <AdaptationSet contentType="audio">
    <Representation id="3" bandwidth="64000" codecs="mp4a.40.2">
      <BaseURL>https://cdn/audio.mp4</BaseURL>
    </Representation>
  </AdaptationSet>
</MPD>`;

describe("HQ video metadata", () => {
  it("converts a shortcode to its numeric media id", () => {
    expect(shortcodeToMediaId("ABC")).toBe("66");
  });

  it("selects the largest video and the audio track", () => {
    expect(parseDashTracks(MANIFEST)).toEqual({
      videoUrl: "https://cdn/video-1080.mp4",
      audioUrl: "https://cdn/audio.mp4",
    });
  });

  it("returns null when either track is absent", () => {
    expect(parseDashTracks(MANIFEST.replace(/mp4a\.40\.2/u, "avc1"))).toBeNull();
  });
});
