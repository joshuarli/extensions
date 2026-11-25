import { describe, expect, it } from "vitest";
import {
  decodeCollection,
  emptyCollection,
  encodeCollection,
  InstagramParseError,
  isPostComplete,
  mediaJobs,
  mediaPaths,
  parseTimelineNode,
  parseTimelinePage,
  renderCollection,
  renderIndex,
  withMembership,
  type Post,
} from "../src/index.ts";

const IMAGE = {
  code: "abc123",
  user: { username: "alice" },
  caption: { text: "hello" },
  image_versions2: { candidates: [
    { url: "https://cdn/small.jpg", width: 100, height: 100 },
    { url: "https://cdn/large.jpg", width: 800, height: 600 },
    { url: "https://cdn/null.jpg?x=1", width: 9000, height: 9000 },
  ] },
};

const CAROUSEL = {
  code: "carousel1",
  user: { username: "alice" },
  carousel_media: [
    { media_type: 1, image_versions2: { candidates: [{ url: "https://cdn/1.jpg", width: 10, height: 10 }] } },
    { media_type: 2, video_versions: [{ url: "https://cdn/2.mp4", width: 20, height: 20 }] },
  ],
};

describe("parseTimelineNode", () => {
  it("selects the largest real image and ignores placeholders", () => {
    const post = parseTimelineNode(IMAGE);
    expect(post).toMatchObject({
      shortcode: "abc123", username: "alice", postType: "image", caption: "hello",
      media: [{ url: "https://cdn/large.jpg", kind: "image", width: 800, height: 600 }],
    });
  });

  it("keeps carousel order and media kinds", () => {
    const post = parseTimelineNode(CAROUSEL);
    expect(post?.postType).toBe("carousel");
    expect(post?.media.map((ref) => ref.kind)).toEqual(["image", "video"]);
  });

  it("fails loudly when a recognized post has no usable media", () => {
    expect(() => parseTimelineNode({ code: "bad", image_versions2: { candidates: [] } }))
      .toThrow(InstagramParseError);
  });

  it("fails loudly on an unrecognized page node", () => {
    expect(() => parseTimelinePage([IMAGE, null])).toThrow(InstagramParseError);
  });
});

describe("media paths and completion", () => {
  const post = parseTimelineNode(CAROUSEL) as Post;

  it("derives stable paths for carousel items", () => {
    expect(mediaPaths(post)).toEqual(["carousel1_1.jpg", "carousel1_2.mp4"]);
  });

  it("creates one job per media item", () => {
    expect(mediaJobs(post).map((job) => job.path)).toEqual(["carousel1_1.jpg", "carousel1_2.mp4"]);
  });

  it("requires every file for completion", () => {
    expect(isPostComplete(post, () => true)).toBe(true);
    expect(isPostComplete(post, (path) => path.endsWith(".jpg"))).toBe(false);
  });
});

describe("collection state", () => {
  it("round-trips membership and cursor", () => {
    const empty = emptyCollection("profile", "alice");
    const state = withMembership(empty, [{
      shortcode: "abc123", username: "alice", postType: "image", capturedAt: "2026-11-25T00:00:00Z", complete: true,
    }]);
    const restored = decodeCollection(encodeCollection({ ...state, cursor: "cursor-1", complete: true }));
    expect(restored?.cursor).toBe("cursor-1");
    expect(restored?.membership["abc123"]?.complete).toBe(true);
  });

  it("rejects malformed state", () => {
    expect(decodeCollection("not json")).toBeNull();
    expect(decodeCollection('{"format":"wrong"}')).toBeNull();
  });
});

describe("site render", () => {
  it("renders a collection page and data without leaking script tags", () => {
    const post: Post = {
      shortcode: "abc123", username: "<script>", postType: "image", caption: "hi",
      media: [{ url: "https://cdn/x.jpg", kind: "image", width: 1, height: 1 }],
    };
    const page = renderCollection({ state: emptyCollection("saved", "alice-saved"), posts: [post] });
    expect(page.files["alice-saved.html"]).toContain("&lt;script&gt;");
    expect(page.files["data/alice-saved.json"]).toContain("abc123.jpg");
    expect(renderIndex([emptyCollection("profile", "alice")])).toContain("alice.html");
  });
});
