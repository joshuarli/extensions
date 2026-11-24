import type { PageMetadata } from "./types.ts";

function yamlString(value: string): string {
  return JSON.stringify(String(value));
}

export function buildFrontmatter(metadata: PageMetadata): string {
  const lines = ["---"],
    add = (key: string, value: string | undefined | null): void => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        lines.push(`${key}: ${yamlString(value)}`);
      }
    };

  add("title", metadata.title);
  if (metadata.author) {
    lines.push("author:", `  - ${yamlString(`[[${metadata.author}]]`)}`);
  }
  add("published", metadata.published);
  add("source", metadata.source);
  add("image", metadata.image);
  add("site", metadata.site);
  add("description", metadata.description);
  add("language", metadata.language);
  lines.push("---");
  return lines.join("\n");
}

export function buildMarkdown(metadata: PageMetadata, transcript: string): string {
  return `${buildFrontmatter(metadata)}\n\n${transcript.trim()}\n`;
}
