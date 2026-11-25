import { join } from "node:path";
import {
  isPostComplete,
  mediaJobs,
  mediaPaths,
  type Post,
} from "../../instagram-archive-core/src/index.ts";
import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import {
  InstagramRequestFailure,
  MediaTooLarge,
  PostMediaUnavailable,
  type PageMedia,
} from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { ArchiveFs } from "./fs.ts";
import { muxVideoAudio } from "./video.ts";
import {
  accountDir,
  collectionDir,
  markPostComplete,
  readPosts,
  readState,
  writePosts,
  writeState,
} from "./store.ts";

export interface GetInput {
  readonly outRoot: string;
  readonly accountId: string;
  readonly key: string;
  readonly kind: "profile" | "saved";
  readonly mediaDir: string;
  readonly limit: number | null;
  readonly maxMediaBytes: number;
}

export interface GetDeps {
  readonly client: InstagramClient;
  readonly fs: ArchiveFs;
  readonly reporter: ProgressReporter;
  readonly signal: AbortSignal;
  readonly pause: (signal: AbortSignal) => Promise<void>;
}

export interface GetSummary {
  readonly downloaded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly remaining: number;
}

export function getTarget(input: GetInput, deps: GetDeps, onPark: (failure: InstagramRequestFailure, key: string, last: string | null) => void): Promise<GetSummary> {
  return runGet(input, deps, onPark);
}

async function runGet(
  input: GetInput,
  deps: GetDeps,
  onPark: (failure: InstagramRequestFailure, key: string, last: string | null) => void,
): Promise<GetSummary> {
  const { client, fs, reporter, signal, pause } = deps;
  const dir = collectionDir(accountDir(input.outRoot, input.accountId), input.key);
  const output = join(dir, input.mediaDir);
  fs.mkdir(output);
  let posts = readPosts(fs, dir);
  let state = readState(fs, dir, input.kind, input.key);
  const exists = (path: string): boolean => {
    const size = fs.size(join(output, path));
    return size !== null && size > 0;
  };
  const pending = posts.filter((post) => !isPostComplete(post, exists));
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let last: string | null = null;
  let total = pending.reduce((sum, post) => sum + mediaJobs(post).length, 0);

  function persistPosts(post: Post): void {
    posts = posts.map((existingPost) => existingPost.shortcode === post.shortcode ? post : existingPost);
    writePosts(fs, dir, posts);
    total = posts.reduce((sum, item) => sum + mediaJobs(item).length, 0);
  }

  function markDone(post: Post): void {
    if (!isPostComplete(post, exists)) return;
    state = markPostComplete(state, post.shortcode);
    writeState(fs, dir, state);
  }

  reporter.update({ phase: "media " + input.key, done: 0, total });

  try {
    let first = true;
    outer: for (const post of pending) {
      if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.download");
      if (!first) await pause(signal);
      first = false;
      let effective = post;
      if (post.media.length === 0) {
        let resolved: readonly PageMedia[];
        try {
          resolved = await client.postPage(post.shortcode, signal);
        } catch (error) {
          if (!(error instanceof PostMediaUnavailable)) throw error;
          failed++;
          reporter.update({ phase: "media " + input.key, done: downloaded + skipped + failed, total, note: post.shortcode + " media unavailable" });
          continue;
        }
        if (resolved.length > 0) {
          const hasVideo = resolved.some((ref) => ref.kind === "video");
          effective = {
            ...post,
            postType: hasVideo ? "video" : resolved.length > 1 ? "carousel" : "image",
            media: resolved.map((ref) => ({
              url: ref.url,
              kind: ref.kind,
              width: ref.width,
              height: ref.height,
            })),
          };
          persistPosts(effective);
        }
      }
      if (effective.postType === "video" && effective.media.length === 1) {
        const finalPath = join(output, post.shortcode + ".mp4");
        const existing = fs.size(finalPath);
        if (existing === null || existing === 0) {
          const tracks = await client.hqTracks(post.shortcode, signal);
          if (tracks !== null) {
            const videoPart = join(output, post.shortcode + ".hqvideo.part");
            const audioPart = join(output, post.shortcode + ".hqaudio.part");
            try {
              fs.writeAtomicBytes(videoPart, await client.mediaBytes(tracks.videoUrl, signal, input.maxMediaBytes));
              fs.writeAtomicBytes(audioPart, await client.mediaBytes(tracks.audioUrl, signal, input.maxMediaBytes));
              const muxed = muxVideoAudio(fs, videoPart, audioPart, finalPath);
              if (muxed.ok) {
                effective = {
                  ...effective,
                  postType: "video",
                  media: [{ url: tracks.videoUrl, kind: "video", width: 0, height: 0 }],
                };
                persistPosts(effective);
                markDone(effective);
                downloaded++;
                last = post.shortcode;
                reporter.update({ phase: "media " + input.key, done: downloaded, total, note: post.shortcode + " (HQ)" });
              } else {
                failed++;
                reporter.update({ phase: "media " + input.key, done: downloaded + failed, total, note: post.shortcode + " mux failed" });
              }
            } catch (error) {
              if (error instanceof MediaTooLarge) {
                skipped++;
                reporter.update({ phase: "media " + input.key, done: downloaded + skipped + failed, total, note: post.shortcode + " too large" });
              } else if (error instanceof InstagramRequestFailure && error.kind !== "stopped") {
                onPark(error, input.key, last);
                throw error;
              } else if (error instanceof InstagramRequestFailure) throw error;
              else failed++;
            } finally {
              fs.remove(videoPart);
              fs.remove(audioPart);
            }
            if (input.limit !== null && downloaded >= input.limit) break;
            continue;
          }
        }
      }
      for (const job of mediaJobs(effective)) {
        const path = join(output, job.path);
        const existing = fs.size(path);
        if (existing !== null && existing > 0) {
          skipped++;
          reporter.update({ phase: "media " + input.key, done: downloaded + skipped, total });
          continue;
        }
        try {
          const bytes = await client.mediaBytes(job.ref.url, signal, input.maxMediaBytes);
          if (bytes.length === 0) throw new Error("empty response body");
          fs.writeAtomicBytes(path, bytes);
          downloaded++;
          last = post.shortcode;
        } catch (error) {
          if (error instanceof MediaTooLarge) {
            skipped++;
          } else if (error instanceof InstagramRequestFailure && error.kind !== "stopped") {
            onPark(error, input.key, last);
            throw error;
          } else if (error instanceof InstagramRequestFailure) throw error;
          else failed++;
        }
        reporter.update({ phase: "media " + input.key, done: downloaded + skipped + failed, total, note: post.shortcode });
        markDone(effective);
        if (input.limit !== null && downloaded >= input.limit) break outer;
      }
    }
  } catch (error) {
    if (!(error instanceof InstagramRequestFailure)) throw error;
    if (error.kind !== "stopped") onPark(error, input.key, last);
    throw error;
  }

  const remaining = posts.filter((post) => {
    const paths = post.media.length > 0
      ? mediaPaths(post)
      : fs.listFiles(output).filter((name) => name.startsWith(post.shortcode));
    return paths.length === 0 || !paths.every((path) => {
      const size = fs.size(join(output, path));
      return size !== null && size > 0;
    });
  }).length;
  reporter.finish("media " + input.key + ": " + downloaded + " downloaded, " + skipped + " skipped, " + failed + " failed");
  return { downloaded, skipped, failed, remaining };
}

export function listCollectionKeys(fs: ArchiveFs, outRoot: string, accountId: string): readonly string[] {
  const root = join(accountDir(outRoot, accountId), "collections");
  return fs.listDirs(root);
}

export function readCollectionPosts(fs: ArchiveFs, outRoot: string, accountId: string, key: string): Post[] {
  return readPosts(fs, collectionDir(accountDir(outRoot, accountId), key));
}
