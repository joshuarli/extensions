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
      expect(html).toContain('<span class="mention">@bob</span>');
      expect(html).toContain('class="context-archive" hidden');
      expect(html).toContain('id="lightbox"');
      expect(html).toContain('id="thread-overlay"');
      expect(html).not.toContain("<script src=");
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
