import { join } from "node:path";
import { HELIUM_BACKEND, type Backend } from "../../lib/cli.ts";
import {
  cookieSession,
  readBrowserSession,
  readCapturedCredentials,
} from "../../x-archive-cli/src/deps.ts";
import { writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { requestWithRetry } from "../../x-archive-core/src/collector.ts";
import {
  appendNewPosts,
  classifyPosts,
  collectHomeTimeline,
  readCursor,
  readPosts,
  summarizeAccounts,
  writeCursor,
  type AccountFinding,
  type DiscoveredPost,
  type PostSignal,
} from "../../x-discovery-core/src/index.ts";

export interface DiscoverOptions {
  cdpUrl: string;
  outDir: string;
  maxPages: number;
  signal: AbortSignal;
  backend?: Backend;
  onStatus?: (message: string) => void;
}

export interface RunSummary {
  pages: number;
  posts: number;
  newPosts: number;
  accounts: number;
  complete: boolean;
  reason: string;
  outDir: string;
}

export function writeDerived(outDir: string, posts: readonly DiscoveredPost[]): {
  signals: PostSignal[];
  accounts: AccountFinding[];
} {
  const signals = classifyPosts(posts);
  const accounts = summarizeAccounts(posts, signals);
  writeJsonFile(join(outDir, "signals.json"), signals);
  writeJsonFile(join(outDir, "accounts.json"), accounts);
  return { signals, accounts };
}

export async function discover(options: DiscoverOptions): Promise<RunSummary> {
  const report = options.onStatus ?? (() => {});
  const postsPath = join(options.outDir, "posts.jsonl");
  const cursorPath = join(options.outDir, "cursor.json");
  report("Connecting to X over " + options.cdpUrl + "…");
  const session = await readBrowserSession(options.cdpUrl, options.backend ?? HELIUM_BACKEND);
  const credentials = await readCapturedCredentials(
    session,
    options.cdpUrl,
    options.backend ?? HELIUM_BACKEND,
    { required: [["HomeTimeline"]], onStatus: report, signal: options.signal },
  );
  let newPosts = 0;
  const result = await collectHomeTimeline({
    request: (variables, signal) => requestWithRetry(
      { credentials: async () => credentials, session: async () => cookieSession(session) },
      session.userId,
      "HomeTimeline",
      variables,
      signal,
      report,
    ),
    savePosts: async (posts) => {
      newPosts += appendNewPosts(postsPath, posts).written;
    },
    readCursor: async () => readCursor(cursorPath),
    writeCursor: async (cursor) => writeCursor(cursorPath, cursor),
    signal: options.signal,
    report,
    maxPages: options.maxPages,
  });
  const posts = readPosts(postsPath);
  const { accounts } = writeDerived(options.outDir, posts);
  return {
    pages: result.pages,
    posts: result.posts,
    newPosts,
    accounts: accounts.length,
    complete: result.completed,
    reason: result.reason,
    outDir: options.outDir,
  };
}
