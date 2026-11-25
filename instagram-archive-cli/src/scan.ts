import {
  parseTimelinePage,
  type CollectionState,
  type Post,
} from "../../instagram-archive-core/src/index.ts";
import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import { InstagramRequestFailure } from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import {
  accountDir,
  appendPosts,
  collectionDir,
  collectionKey,
  markMembership,
  readPosts,
  readState,
  writeState,
} from "./store.ts";
import type { ArchiveFs } from "./fs.ts";

export interface ScanInput {
  readonly target: string;
  readonly saved: boolean;
  readonly outRoot: string;
  readonly accountId: string;
  readonly limit: number | null;
}

export interface ScanDeps {
  readonly client: InstagramClient;
  readonly fs: ArchiveFs;
  readonly reporter: ProgressReporter;
  readonly now: () => number;
  readonly signal: AbortSignal;
}

export interface ScanSummary {
  readonly key: string;
  readonly written: number;
  readonly total: number;
  readonly complete: boolean;
  readonly collection: CollectionState;
}

export function scanTarget(input: ScanInput, deps: ScanDeps, onPark: (failure: InstagramRequestFailure, key: string, last: string | null) => void): Promise<ScanSummary> {
  const { key, kind, username } = collectionKey(input.target, input.saved);
  return runScan(input, deps, { key, kind, username }, onPark);
}

async function runScan(
  input: ScanInput,
  deps: ScanDeps,
  target: { key: string; kind: "profile" | "saved"; username: string | null },
  onPark: (failure: InstagramRequestFailure, key: string, last: string | null) => void,
): Promise<ScanSummary> {
  const { client, fs, reporter, signal } = deps;
  const dir = collectionDir(accountDir(input.outRoot, input.accountId), target.key);
  fs.mkdir(dir);
  let state = readState(fs, dir, target.kind, target.key);
  const saved = readPosts(fs, dir);
  const known = new Set(saved.map((post) => post.shortcode));
  const posts: Post[] = [];
  let last: string | null = null;

  async function commit(newPosts: readonly Post[], complete: boolean): Promise<void> {
    if (newPosts.length > 0) {
      appendPosts(fs, dir, newPosts);
      state = markMembership(state, newPosts, new Date(deps.now()).toISOString());
    }
    state = { ...state, complete };
    writeState(fs, dir, state);
  }

  try {
    if (target.kind === "saved") {
      if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "saved");
      reporter.update({ phase: "list saved", done: 0, total: 0 });
      const codes = await client.savedShortcodes(signal);
      for (const shortcode of codes) {
        if (known.has(shortcode)) continue;
        posts.push({
          shortcode,
          username: null,
          postType: "image",
          caption: null,
          media: [],
        });
        known.add(shortcode);
        last = shortcode;
        if (input.limit !== null && posts.length >= input.limit) break;
      }
      await commit(posts, true);
    } else {
      const profile = await client.openProfile(target.username ?? target.key, signal);
      let cursor = state.complete ? null : state.cursor;
      let hasNext = true;
      while (hasNext) {
        if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "profile.posts");
        const page = await client.profilePage(profile, cursor, signal);
        const parsed = parseTimelinePage(page.posts, target.username);
        const fresh = parsed.filter((post) => !known.has(post.shortcode));
        const remaining = input.limit === null ? fresh.length : Math.max(0, input.limit - posts.length);
        const accepted = fresh.slice(0, remaining);
        for (const post of accepted) {
          posts.push(post);
          known.add(post.shortcode);
          last = post.shortcode;
        }
        cursor = page.cursor;
        const exhausted = !page.hasNext || cursor === null;
        hasNext = !exhausted && posts.length < (input.limit ?? Number.MAX_SAFE_INTEGER);
        reporter.update({ phase: "scan " + target.key, done: posts.length, total: posts.length + known.size - posts.length });
        await commit(accepted, exhausted);
      }
    }
  } catch (error) {
    if (error instanceof InstagramRequestFailure && error.kind !== "stopped") {
      onPark(error, target.key, last);
    }
    throw error;
  }

  const total = readPosts(fs, dir).length;
  reporter.finish("scanned " + target.key + ": " + posts.length + " new, " + total + " total");
  return { key: target.key, written: posts.length, total, complete: state.complete, collection: state };
}
