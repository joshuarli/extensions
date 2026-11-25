import { resolve } from "node:path";
import { connectX } from "../../x-client-core/src/client.ts";
import { followingFromUserLookup } from "../../x-client-core/src/follow.ts";
import { extractLookupUserId } from "../../x-archive-core/src/collector.ts";
import { markFollowed, readLedger } from "../../x-discovery-core/src/ledger.ts";
import type { ProjectConfig } from "../../x-discovery-core/src/project.ts";

export interface FollowOptions {
  handles: readonly string[];
  project: ProjectConfig;
  ledgerPath?: string | undefined;
  dryRun?: boolean | undefined;
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  signal: AbortSignal;
  onStatus?: ((message: string) => void) | undefined;
}

export interface FollowSummary {
  alreadyFollowing: string[];
  followed: string[];
  skipped: string[];
  failures: string[];
  dryRun: boolean;
}

export async function followHandles(options: FollowOptions): Promise<FollowSummary> {
  if (options.handles.length === 0) throw new Error("follow needs --handles=a,b.");
  const ledgerPath = options.ledgerPath ?? resolve(process.cwd(), options.project.ledger_path);
  const tracked = new Set(readLedger(ledgerPath).filter((record) => record.status === "followed")
    .map((record) => record.author_id));
  const client = await connectX({
    cdpUrl: options.cdpUrl,
    backend: options.backend,
    session: options.session,
    required: [["UserByScreenName"]],
    signal: options.signal,
    onStatus: options.onStatus,
  });
  const result: FollowSummary = { alreadyFollowing: [], followed: [], skipped: [], failures: [], dryRun: options.dryRun === true };
  for (const handle of options.handles) {
    if (options.signal.aborted) break;
    const name = handle.replace(/^@/u, "");
    try {
      const lookup = await client.request("UserByScreenName", { screen_name: name }, options.signal);
      const userId = extractLookupUserId(lookup);
      if (!userId) throw new Error("profile id not found");
      if (followingFromUserLookup(lookup) === true || tracked.has(userId)) {
        if (!options.dryRun) markFollowed(ledgerPath, [userId]);
        result.alreadyFollowing.push(name);
        continue;
      }
      if (options.dryRun) {
        result.skipped.push(name);
        continue;
      }
      options.onStatus?.("Following @" + name + "…");
      await client.follow(userId, options.signal);
      const verified = await client.request("UserByScreenName", { screen_name: name }, options.signal);
      if (followingFromUserLookup(verified) !== true) throw new Error("follow was not reflected in the profile state");
      markFollowed(ledgerPath, [userId]);
      result.followed.push(name);
    } catch (error) {
      result.failures.push(name + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return result;
}
