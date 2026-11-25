import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectX, operationForFeed } from "../../x-client-core/src/client.ts";
import { writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { downloadsRoot } from "../../x-archive-cli/src/state.ts";
import {
  collectHomeTimeline,
  deriveAccounts,
  extractResourceLinks,
  readArchiveCandidates,
  DiscoveryStore,
  newRun,
  type AccountFinding,
  type Feed,
} from "../../x-discovery-core/src/index.ts";
import { checkLinks, LINK_VERSION } from "../../x-discovery-core/src/links.ts";
import { TOPIC_VERSION, classifyTopic } from "../../x-discovery-core/src/topic.ts";

export interface DiscoverOptions {
  outDir: string;
  maxPages: number;
  feed: Feed;
  signal: AbortSignal;
  cdpUrl?: string | undefined;
  backend?: string | undefined;
  session?: string | undefined;
  onStatus?: ((message: string) => void) | undefined;
}

export interface CollectSummary {
  runId: string;
  accountId: string;
  pages: number;
  posts: number;
  newPosts: number;
  stopReason: string;
  outDir: string;
}

function storePath(outDir: string): string {
  return join(outDir, "discovery.db");
}

function report(message: string, onStatus?: (text: string) => void): void {
  onStatus?.(message);
}

export async function collectFeed(options: DiscoverOptions): Promise<CollectSummary> {
  const store = new DiscoveryStore(storePath(options.outDir));
  try {
    const prior = store.runs()[0];
    if (prior && prior.feed !== options.feed) {
      report("Note: the latest observation used " + prior.feed + "; this run uses " + options.feed + ".", options.onStatus);
    }
    const client = await connectX({
      cdpUrl: options.cdpUrl,
      backend: options.backend,
      session: options.session,
      expectedAccountId: prior?.accountId,
      required: [[operationForFeed(options.feed)]],
      feed: options.feed,
      signal: options.signal,
      onStatus: options.onStatus,
    });
    const runId = newRun(client.accountId, options.feed, options.maxPages).runId;
    if (!store.acquireJobLock(client.accountId, runId)) {
      throw new Error("Another discovery run is active for this account. Wait for it to finish.");
    }
    store.beginRun({
      runId,
      accountId: client.accountId,
      feed: options.feed,
      startedAt: new Date().toISOString(),
      endedAt: null,
      stopReason: null,
      budgetPages: options.maxPages,
    });
    const knownBefore = new Set(store.allPosts().map((post) => post.tweet_id));
    let stopReason = "max_pages";
    let pages = 0;
    try {
      const result = await collectHomeTimeline({
        request: (variables, signal) => client.request(operationForFeed(client.feed), variables, signal),
        savePosts: async () => {},
        readCursor: async () => store.readCheckpoint(runId),
        writeCursor: async () => {},
        commitPage: async (input) => store.commitPage({ ...input, runId, accountId: client.accountId, feed: options.feed }),
        signal: options.signal,
        report: (message) => report(message, options.onStatus),
        maxPages: options.maxPages,
      });
      stopReason = result.reason;
      pages = result.pages;
      const posts = result.posts;
      report("Committed " + posts + " observed posts in " + result.pages + " pages.", options.onStatus);
    } finally {
      store.finishRun(runId, stopReason);
      store.releaseJobLock(client.accountId, runId);
    }
    const all = store.allPosts();
    return {
      runId,
      accountId: client.accountId,
      pages,
      posts: all.length,
      newPosts: all.filter((post) => !knownBefore.has(post.tweet_id)).length,
      stopReason,
      outDir: options.outDir,
    };
  } finally {
    store.close();
  }
}

export interface DeriveSummary {
  posts: number;
  topics: number;
  links: number;
  accounts: number;
  cached: boolean;
  linkChecks: number | null;
}

export async function deriveFindings(options: {
  outDir: string;
  checkLinks?: boolean;
  linkBudget?: number;
}): Promise<DeriveSummary> {
  const store = new DiscoveryStore(storePath(options.outDir));
  try {
    const posts = store.allPosts();
    const topics = posts.map(classifyTopic);
    const links = posts.flatMap(extractResourceLinks);
    const inputHash = createHash("sha256").update(JSON.stringify([
      posts.map((post) => post.tweet_id + ":" + (post.relationship?.kind ?? "original")),
      TOPIC_VERSION,
      LINK_VERSION,
    ])).digest("hex").slice(0, 16);
    const cached = store.derivation(inputHash, "accounts-1") as AccountFinding[] | null;
    const accounts = cached ?? deriveAccounts(posts, topics, links);
    if (!cached) store.saveDerivation(inputHash, "accounts-1", accounts);
    writeJsonFile(join(options.outDir, "topics.json"), topics, 0o644);
    writeJsonFile(join(options.outDir, "links.json"), links, 0o644);
    writeJsonFile(join(options.outDir, "accounts.json"), accounts, 0o644);
    let linkChecks: number | null = null;
    if (options.checkLinks) {
      const checks = await checkLinks(links, options.linkBudget ?? 3);
      writeJsonFile(join(options.outDir, "link-checks.json"), checks, 0o644);
      linkChecks = checks.length;
    }
    return { posts: posts.length, topics: topics.length, links: links.length, accounts: accounts.length, cached: cached !== null, linkChecks };
  } finally {
    store.close();
  }
}

export function buildReport(outDir: string): string {
  const store = new DiscoveryStore(storePath(outDir));
  try {
    let accounts: AccountFinding[] = [];
    try {
      accounts = JSON.parse(readFileSync(join(outDir, "accounts.json"), "utf8")) as AccountFinding[];
    } catch {
      accounts = [];
    }
    const runs = store.runs();
    const lines = ["# Arthouse discovery", ""];
    lines.push("Runs: " + runs.length + ". Latest stop reason: " + (runs[0]?.stopReason ?? "none") + ".", "");
    for (const account of accounts.slice(0, 20)) {
      lines.push("## @" + account.handle + " (" + account.author_id + ")");
      lines.push("Role: " + account.role + ". Relevant posts: " + account.relevant_posts
        + "/" + account.posts_examined + ". Resource links: " + account.resource_links
        + ". Uncertainty: " + account.uncertainty + ".");
      lines.push(account.reason);
      for (const example of account.examples) {
        lines.push("- " + example.source_url + " — score " + example.score + ": " + example.text);
      }
      for (const link of account.link_examples) lines.push("- link: " + link);
      lines.push("");
    }
    return lines.join("\n");
  } finally {
    store.close();
  }
}

export function bootstrapCandidates(outDir: string): ReturnType<typeof readArchiveCandidates> {
  const candidates = readArchiveCandidates(downloadsRoot());
  writeJsonFile(join(outDir, "candidates.json"), candidates, 0o644);
  return candidates;
}
