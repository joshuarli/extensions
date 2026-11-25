import { describe, expect, it } from "vitest";
import { parsePostMedia } from "../src/post-media.ts";

function scriptWith(payload: unknown): string {
  return JSON.stringify({ require: [[null, null, null, [{ __bbox: { require: [[null, null, null, [{ __bbox: { result: { data: payload } } }]]] } }]]] });
}

const WEB_INFO = {
  xdt_api__v1__media__shortcode__web_info: {
    items: [{
      code: "abc",
      carousel_media: [
        {
          image_versions2: {
            candidates: [
              { url: "https://cdn/small.jpg", width: 1, height: 1 },
              { url: "https://cdn/big.jpg", width: 10, height: 10 },
            ],
          },
        },
        {
          image_versions2: { candidates: [{ url: "https://cdn/cover.jpg", width: 4, height: 4 }] },
          video_versions: [
            { url: "https://cdn/small.mp4", width: 2, height: 2 },
            { url: "https://cdn/big.mp4", width: 8, height: 8 },
          ],
        },
      ],
    }],
  },
};

describe("parsePostMedia", () => {
  it("takes the web-info item for the shortcode and the best candidate per slide", () => {
    const grid = { xdt_api__v1__profile_timeline: { profile_grid_items: [{ media: { code: "other", image_versions2: { candidates: [{ url: "https://cdn/other.jpg", width: 99, height: 99 }] } } }] } };
    expect(parsePostMedia([scriptWith(grid), scriptWith(WEB_INFO)], "abc")).toEqual([
      { url: "https://cdn/big.jpg", kind: "image", width: 10, height: 10 },
      { url: "https://cdn/big.mp4", kind: "video", width: 8, height: 8 },
    ]);
  });

  it("accepts null carousel and video fields from the wire", () => {
    const payload = { xdt_api__v1__media__shortcode__web_info: { items: [{
      code: "abc",
      carousel_media: null,
      video_versions: null,
      image_versions2: { candidates: [{ url: "https://cdn/cover.jpg", width: 4, height: 4 }] },
    }] } };
    expect(parsePostMedia([scriptWith(payload)], "abc")).toEqual([
      { url: "https://cdn/cover.jpg", kind: "image", width: 4, height: 4 },
    ]);
  });

  it("returns no media for an unknown shortcode or unparseable script", () => {
    expect(parsePostMedia(["not json", scriptWith(WEB_INFO)], "missing")).toEqual([]);
  });
});
