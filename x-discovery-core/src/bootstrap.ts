import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

export const ArchiveAuthorSchema = Schema.Struct({
  user_id: Schema.String,
  screen_name: Schema.String,
  name: Schema.optional(Schema.String),
});

export const ArchivePostSchema = Schema.Struct({
  tweet_id: Schema.String,
  full_text: Schema.optional(Schema.String),
  author: Schema.optional(ArchiveAuthorSchema),
});

export interface CandidateAccount {
  author_id: string;
  handle: string;
  sources: string[];
  posts: number;
  examples: string[];
}

export function readArchiveCandidates(root: string): CandidateAccount[] {
  const files: Array<{ path: string; source: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = entry.name.startsWith("bookmarks-") ? "bookmarks"
      : entry.name.startsWith("likes-") ? "likes" : null;
    if (!source) continue;
    files.push({ path: join(root, entry.name, source + ".json"), source });
  }
  const accounts = new Map<string, CandidateAccount>();
  for (const { path, source } of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error("Could not read archive " + path + ": " + (error instanceof Error ? error.message : String(error)));
    }
    const container = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[source]
      : null;
    if (!Array.isArray(container)) continue;
    for (const record of container) {
      const result = Schema.decodeUnknownOption(ArchivePostSchema)(record);
      if (result._tag === "None" || !result.value.author) continue;
      const author = result.value.author;
      const account = accounts.get(author.user_id) ?? {
        author_id: author.user_id,
        handle: author.screen_name,
        sources: [],
        posts: 0,
        examples: [],
      };
      if (!account.sources.includes(source)) account.sources.push(source);
      account.posts++;
      if (account.examples.length < 3 && result.value.full_text) {
        account.examples.push(result.value.full_text.slice(0, 200));
      }
      accounts.set(author.user_id, account);
    }
  }
  return [...accounts.values()].sort((a, b) => b.posts - a.posts || a.handle.localeCompare(b.handle));
}
