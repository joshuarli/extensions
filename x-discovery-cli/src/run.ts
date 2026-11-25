import { createHash } from "node:crypto";
import { Schema } from "effect";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectX, operationForFeed } from "../../x-client-core/src/client.ts";
import { writeJsonFile } from "../../x-archive-cli/src/state.ts";
import { downloadsRoot } from "../../x-archive-cli/src/state.ts";
import {
  collectHomeTimeline,
  AccountFindingSchema,
  ResourceLinkSchema,
  TopicJudgmentSchema,
  appendFinds,
  deriveAccounts,
  extractResourceLinks,
  readArchiveCandidates,
  DiscoveryStore,
  newRun,
  type AccountFinding,
  type Feed,
  type FindRecord,
  type ProjectConfig,
  projectVersion,
} from "../../x-discovery-core/src/index.ts";
import { checkLinks } from "../../x-discovery-core/src/links.ts";
import { classifyTopic } from "../../x-discovery-core/src/topic.ts";

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
    const knownBefore = new Set(store.allPosts().map((post) => post.tweet_id));
    let stopReason = "failed";
    let pages = 0;
    try {
      store.beginRun({
        runId,
        accountId: client.accountId,
        feed: options.feed,
        startedAt: new Date().toISOString(),
        endedAt: null,
        stopReason: null,
        budgetPages: options.maxPages,
      });
      const result = await collectHomeTimeline({
        request: (variables, signal) => client.request(operationForFeed(client.feed), variables, signal),
        savePosts: async () => {},
        readCursor: async () => store.readCheckpoint(runId),
        writeCursor: async () => {},
        commitPage: async (input) => store.commitPage({ ...input, runId, accountId: client.accountId, feed: options.feed }),
        commitFailure: async (failure) => {
          store.saveFailure(runId, failure.page, failure.data, failure.detail);
          report("Page " + failure.page + " saved for inspection: " + failure.detail, options.onStatus);
        },
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
  project: ProjectConfig;
  checkLinks?: boolean;
  linkBudget?: number;
}): Promise<DeriveSummary> {
  const store = new DiscoveryStore(storePath(options.outDir));
  try {
    const posts = store.allPosts();
    const topics = posts.map((post) => classifyTopic(post, options.project));
    const links = posts.flatMap((post) => extractResourceLinks(post, options.project));
    const version = projectVersion(options.project);
    const inputHash = createHash("sha256").update(JSON.stringify([
      posts.map((post) => JSON.stringify([
        post.tweet_id,
        post.full_text,
        post.urls,
        post.relationship?.kind ?? "original",
      ])),
      version,
    ])).digest("hex").slice(0, 16);
    const raw = store.derivation(inputHash, version);
    let cached: AccountFinding[] | null = null;
    if (raw !== null) {
      try {
        cached = [...Schema.decodeUnknownSync(Schema.Array(AccountFindingSchema))(raw)];
      } catch {
        cached = null;
      }
    }
    const accounts = cached ?? deriveAccounts(posts, topics, links);
    if (!cached) store.saveDerivation(inputHash, version, accounts);
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
      const persisted: unknown = JSON.parse(readFileSync(join(outDir, "accounts.json"), "utf8"));
      accounts = [...Schema.decodeUnknownSync(Schema.Array(AccountFindingSchema))(persisted)];
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

export function trackFinds(options: {
  outDir: string;
  project: ProjectConfig;
  ledgerPath?: string | undefined;
}): { added: number; duplicates: number; accounts: string[] } {
  const ledgerPath = options.ledgerPath ?? resolve(process.cwd(), options.project.ledger_path);
  const accountsRaw: unknown = JSON.parse(readFileSync(join(options.outDir, "accounts.json"), "utf8"));
  const topicsRaw: unknown = JSON.parse(readFileSync(join(options.outDir, "topics.json"), "utf8"));
  const linksRaw: unknown = JSON.parse(readFileSync(join(options.outDir, "links.json"), "utf8"));
  const accounts = Schema.decodeUnknownSync(Schema.Array(AccountFindingSchema))(accountsRaw);
  const topics = Schema.decodeUnknownSync(Schema.Array(TopicJudgmentSchema))(topicsRaw);
  const links = Schema.decodeUnknownSync(Schema.Array(ResourceLinkSchema))(linksRaw);
  const topicByTweet = new Map(topics.map((topic) => [topic.tweet_id, topic]));
  const at = new Date().toISOString();
  const records: FindRecord[] = [];
  const handles = new Set<string>();
  for (const account of accounts) {
    if (account.relevant_posts === 0 && account.resource_links === 0) continue;
    handles.add(account.handle);
    for (const example of account.examples) {
      const tweetId = example.source_url.split("/").pop() ?? "";
      if (!/^\d+$/u.test(tweetId)) continue;
      const topic = topicByTweet.get(tweetId);
      if (!topic || topic.verdict !== "relevant") continue;
      records.push({
        tweet_id: tweetId,
        author_id: account.author_id,
        author_handle: account.handle,
        source_url: example.source_url,
        topic_score: topic.score,
        links: links.filter((link) => link.source_tweet_id === tweetId).map((link) => link.url),
        note: example.text + " — " + topic.reason,
        discovered_at: at,
        status: "seen",
      });
    }
  }
  const result = appendFinds(ledgerPath, records);
  return { ...result, accounts: [...handles] };
}
