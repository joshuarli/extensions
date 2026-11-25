import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderArchive } from "../src/render.ts";

const scratchRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".work", "tmp");

describe("renderArchive", () => {
  it("writes a static archive page with UTC dates and offline thread context", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{
          tweet_id: "1",
          created_at: "Wed Oct 10 20:19:24 +0000 2018",
          author: { name: "Alice", screen_name: "alice" },
          full_text: "Hello @bob #hi",
          conversation_id: "1",
          metrics: { likes: 12 },
        }],
        context_posts: [{
          tweet_id: "9",
          created_at: "Mon Jan 01 00:00:00 +0000 2024",
          author: { name: "Ancestor", screen_name: "anc" },
          full_text: "context",
          conversation_id: "1",
        }],
        profile: { name: "Alice", screen_name: "alice" },
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");

      expect(result.posts).toBe(1);
      expect(html).toContain("Oct 10, 2018 · 8:19 PM");
      expect(html).toContain("Hello @bob #hi");
      expect(html).toContain('class="context-archive" hidden');
      expect(html).toContain('id="lightbox"');
      expect(html).toContain('id="thread-overlay"');
      expect(html).not.toContain("<script src=");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("renders quoted posts, cards and repost attribution", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-quote-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{
          tweet_id: "1",
          created_at: "Mon Jan 01 00:00:00 +0000 2024",
          full_text: "main",
          author: { name: "Alice", screen_name: "alice" },
          repost_of: "2",
          reposted_by: { name: "Bob", screen_name: "bob" },
          quoted_tweet: {
            tweet_id: "3",
            created_at: "Wed Oct 10 20:19:24 +0000 2018",
            full_text: "quoted text https://t.co/x",
            author: { name: "Carol", screen_name: "carol" },
            entities: { urls: [{ url: "https://t.co/x", expanded_url: "https://example.com" }] },
            metrics: { likes: 7 },
          },
          card: { title: "A card", description: "details", url: "https://example.org", bindings: { poll1_choice1: "Yes", poll1_choice2: "No" } },
        }],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain("<b>Bob</b> reposted");
      expect(html).toContain("Oct 10, 2018 · 8:19 PM");
      expect(html).not.toContain("unknown date");
      expect(html).toContain("A card");
      expect(html).toContain("<li>Yes</li>");
      expect(html).toContain("https://example.com");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("uses the requested profile handle instead of a donor author", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-profile-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [
          { tweet_id: "1", full_text: "one", author: { screen_name: "bob", name: "Bob" } },
          { tweet_id: "2", full_text: "two", author: { screen_name: "bob", name: "Bob" } },
        ],
        profile: { user_id: "42" },
        export_metadata: { requested_profile: "alice" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain('<div class="handle">@alice</div>');
      expect(html).not.toContain('<div class="handle">@bob</div>');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reports partial collection and missing media in the footer", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-status-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{ tweet_id: "1", full_text: "hello" }],
        export_metadata: { collection: { posts: "partial", reason: "rate limited" } },
      }));
      writeFileSync(join(folder, "debug.json"), JSON.stringify({
        media: { failed: [{ filename: "1_0.mp4", error: "HTTP 500" }], skipped: [{ filename: "1_1.mp4", bytes: 99 }] },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain("Collection: posts partial (rate limited)");
      expect(html).toContain("1 media file(s) failed to download");
      expect(html).toContain("1 media file(s) skipped");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("does not turn a hostile entity URL into a link", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-url-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{
          tweet_id: "1",
          full_text: "see https://t.co/x",
          entities: { urls: [{ url: "https://t.co/x", expanded_url: "javascript:alert(1)" }] },
        }],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).not.toContain('href="javascript:');
      expect(html).toContain("https://t.co/x");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("marks unarchived media and shows every gallery item", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-media-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{
          tweet_id: "1",
          full_text: "photos",
          media: Array.from({ length: 5 }, (_, index) => ({ type: "photo", url: `https://pbs.twimg.com/media/${index}.jpg` })),
        }],
        media_manifest: [
          { tweet_id: "1", index: 0, filename: "1_0.jpg", url: "https://pbs.twimg.com/media/0.jpg", status: "downloaded", bytes: 10, sha256: "abc" },
          { tweet_id: "1", index: 1, filename: "1_1.jpg", url: "https://pbs.twimg.com/media/1.jpg", status: "skipped", bytes: 99 },
        ],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      mkdirSync(join(folder, "media"), { recursive: true });
      writeFileSync(join(folder, "media", "1_0.jpg"), "bytes");
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain("Media not archived: skipped during collection");
      expect(html).toContain('href="media/1_0.jpg"');
      expect(html.match(/class="item"/gu)?.length).toBe(1);
      expect(html.match(/class="unavailable-media"/gu)?.length).toBe(4);
      expect(html).toContain("media/1_4.jpg");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("reports thread context gaps", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-context-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{ tweet_id: "1", full_text: "reply", conversation_id: "c" }],
        context_posts: [{ tweet_id: "9", full_text: "ancestor", conversation_id: "c" }],
        export_metadata: { exported_at: "2026-01-01", stats: { context_failed: 2, context_unreachable: 1 } },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain("thread-context posts (text only)");
      expect(html).toContain("2 context pages failed, 1 unreachable");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("renders folders, verification, source and entity links", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-fields-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [{
          tweet_id: "1",
          full_text: "hello @bob and #film",
          author: { name: "Alice", screen_name: "alice", verified: true },
          source: "Twitter for iPhone",
          folders: ["Films", "Favourites"],
          entities: {
            mentions: [{ screen_name: "bob", user_id: "2" }],
            hashtags: ["film"],
            urls: [],
          },
        }],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html).toContain("Folders: Films · Favourites");
      expect(html).toContain('title="Verified"');
      expect(html).toContain("via Twitter for iPhone");
      expect(html).toContain('<a class="mention" href="https://x.com/bob"');
      expect(html).toContain('<a class="hashtag" href="https://x.com/hashtag/film"');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("gives thread posts a chronological key", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-thread-"));
    try {
      writeFileSync(join(folder, "posts.json"), JSON.stringify({
        posts: [
          { tweet_id: "1", created_at: "Wed Oct 10 20:19:24 +0000 2018", full_text: "reply", conversation_id: "c", in_reply_to_tweet_id: "9" },
          { tweet_id: "2", created_at: "Mon Jan 01 00:00:00 +0000 2024", full_text: "later", conversation_id: "c" },
        ],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html.match(/data-created-ms="\d+"/gu)?.length).toBe(2);
      expect(html).toContain('Number(a.getAttribute("data-created-ms") || 0)');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("keeps the export order for bookmarks", async () => {
    mkdirSync(scratchRoot, { recursive: true });
    const folder = mkdtempSync(join(scratchRoot, "x-render-order-"));
    try {
      writeFileSync(join(folder, "bookmarks.json"), JSON.stringify({
        bookmarks: [
          { tweet_id: "old", created_at: "Mon Jan 01 00:00:00 +0000 2024", full_text: "older post" },
          { tweet_id: "new", created_at: "Wed Oct 10 20:19:24 +0000 2018", full_text: "newer post" },
        ],
        export_metadata: { exported_at: "2026-01-01" },
      }));
      const result = await renderArchive({ folder, noFetch: true });
      const html = readFileSync(result.output, "utf8");
      expect(html.indexOf("older post")).toBeLessThan(html.indexOf("newer post"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
