import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";

export async function listFollowing(client: InstagramClient, reporter: ProgressReporter, signal: AbortSignal): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    if (signal.aborted) break;
    const page = await client.followingPage(client.accountId, cursor, signal);
    for (const user of page.users) {
      if (user === null || typeof user !== "object") continue;
      const record = user as Record<string, unknown>;
      if (typeof record["username"] === "string") names.push(record["username"]);
    }
    reporter.update({ phase: "following", done: names.length, total: names.length });
    if (page.cursor === null || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  return names;
}
