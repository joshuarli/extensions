import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../lib/test/tmp.ts";
import { renderArchive } from "../src/render.ts";

let directory: string | undefined;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("X export contract", () => {
  it("exports JSON, media and HTML that agree offline and deterministically", async () => {
    directory = makeTempDir("x-export-contract-");
    const folder = directory;
    mkdirSync(join(folder, "media"), { recursive: true });
    writeFileSync(join(folder, "media", "1_0.jpg"), "image bytes");
    writeFileSync(join(folder, "debug.json"), JSON.stringify({ media: { failed: [], skipped: [] } }));
    const posts = [
      {
        tweet_id: "1",
        created_at: "Mon Jan 01 00:00:00 +0000 2024",
        full_text: "first post https://t.co/link",
        author: { name: "Alice", screen_name: "alice" },
        repost_of: "9",
        reposted_by: { name: "Bob", screen_name: "bob" },
        entities: { urls: [{ url: "https://t.co/link", expanded_url: "https://example.com" }] },
        media: [{ type: "photo", url: "https://pbs.twimg.com/media/a.jpg", alt_text: "a photo" }],
        quoted_tweet: {
          tweet_id: "2",
          created_at: "Wed Oct 10 20:19:24 +0000 2018",
          full_text: "quoted",
          author: { name: "Carol", screen_name: "carol" },
          metrics: { likes: 7 },
        },
        card: { title: "A card", url: "https://example.org", bindings: {} },
        metrics: { likes: 3 },
      },
      {
        tweet_id: "3",
        created_at: "Wed Oct 10 20:19:24 +0000 2018",
        full_text: "second post",
        author: { name: "Alice", screen_name: "alice" },
      },
    ];
    writeFileSync(join(folder, "posts.json"), JSON.stringify({
      posts,
      profile: { name: "Alice", screen_name: "alice" },
      export_metadata: { exported_at: "2026-01-01", collection: { posts: "complete" } },
    }));

    const first = await renderArchive({ folder, output: join(folder, "one.html"), noFetch: true });
    const second = await renderArchive({ folder, output: join(folder, "two.html"), noFetch: true });
    expect(readFileSync(first.output, "utf8")).toBe(readFileSync(second.output, "utf8"));

    const html = readFileSync(first.output, "utf8");
    for (const match of html.matchAll(/href="media\/([^"]+)"/gu)) {
      expect(existsSync(join(folder, "media", match[1]!))).toBe(true);
    }
    expect(html.indexOf("first post")).toBeLessThan(html.indexOf("second post"));
    expect(html).toContain("<b>Bob</b> reposted");
    expect(html).toContain("@carol");
    expect(html).toContain("Oct 10, 2018 · 8:19 PM");
    expect(html).toContain("A card");
    expect(html).toContain('<div class="handle">@alice</div>');
    expect(html).not.toContain("unknown date");
  });
});
