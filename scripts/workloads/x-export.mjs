import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractConversationTweets, parseContextTweet } from "../../x-archive-core/src/conversation.ts";

const rootConversation = "2121990160426381595";
const observedAt = "2026-11-17T00:00:00.000Z";

export async function run(options = {}) {
  const root = process.cwd();
  const html = readFileSync(resolve(root, "x-archive-cli/test/fixtures/conversation-page.html"), "utf8");
  const parsed = extractConversationTweets(html).tweets
    .map((tweet) => parseContextTweet(tweet, rootConversation, observedAt))
    .filter((record) => record !== null);
  if (parsed.length === 0) throw new Error("conversation fixture produced no records");
  const directory = resolve(root, ".work", "tmp", "bench-x-export");
  mkdirSync(directory, { recursive: true });
  const samples = [];
  const count = options.samples ?? 5;
  const recordsPerRun = options.records ?? 500;
  try {
    for (let iteration = 0; iteration < count; iteration += 1) {
      const records = Array.from({ length: recordsPerRun }, (_, index) => {
        const source = parsed[index % parsed.length];
        return { ...source, tweet_id: String(9_000_000_000_000_000 + index), conversation_id: rootConversation };
      });
      const path = join(directory, `export-${iteration}.json`);
      const bytes = Buffer.from(JSON.stringify({ records, exportedAt: observedAt }));
      writeFileSync(path, bytes);
      const restored = JSON.parse(readFileSync(path, "utf8"));
      if (restored.records.length !== recordsPerRun) throw new Error("export lost records");
      if (restored.records[recordsPerRun - 1]?.tweet_id !== String(9_000_000_000_000_000 + recordsPerRun - 1)) {
        throw new Error("export record identity changed");
      }
      samples.push({ bytes: bytes.length, records: recordsPerRun, work: recordsPerRun });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return { name: "x-export", samples };
}
