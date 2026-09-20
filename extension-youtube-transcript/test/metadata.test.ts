import test from "node:test";
import assert from "node:assert/strict";
import { buildFrontmatter, buildMarkdown } from "../src/metadata.ts";

test("builds Obsidian-compatible YouTube frontmatter", () => {
  const frontmatter = buildFrontmatter({
    title: "How to Build a CLI Tool",
    author: "Tech Channel",
    published: "2024-06-15",
    source: "https://www.youtube.com/watch?v=abc123",
    image: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
    site: "YouTube",
    description: 'A useful "description".',
    language: "en",
  });

  assert.equal(
    frontmatter,
    `---
title: "How to Build a CLI Tool"
author:
  - "[[Tech Channel]]"
published: "2024-06-15"
source: "https://www.youtube.com/watch?v=abc123"
image: "https://i.ytimg.com/vi/abc123/maxresdefault.jpg"
site: "YouTube"
description: "A useful \\"description\\"."
language: "en"
---`,
  );
});

test("omits empty optional metadata and appends the transcript", () => {
  const markdown = buildMarkdown(
    { source: "https://youtu.be/abc123", site: "YouTube" },
    "**0:00** · Hello",
  );
  assert.equal(
    markdown,
    `---
source: "https://youtu.be/abc123"
site: "YouTube"
---

**0:00** · Hello
`,
  );
  assert.doesNotMatch(markdown, /author:/);
});
