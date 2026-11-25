import { join } from "node:path";
import {
  isPostComplete,
  mediaJobs,
  mediaPaths,
  type Post,
} from "../../instagram-archive-core/src/index.ts";
import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import { InstagramRequestFailure } from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { ArchiveFs } from "./fs.ts";
import { muxVideoAudio } from "./video.ts";
import { accountDir, collectionDir, readPosts } from "./store.ts";

export interface GetInput {
  readonly outRoot: string;
  readonly accountId: string;
  readonly key: string;
  readonly mediaDir: string;
  readonly limit: number | null;
}

export interface GetDeps {
  readonly client: InstagramClient;
  readonly fs: ArchiveFs;
  readonly reporter: ProgressReporter;
  readonly signal: AbortSignal;
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
  const { client, fs, reporter, signal } = deps;
  const dir = collectionDir(accountDir(input.outRoot, input.accountId), input.key);
  const output = join(dir, input.mediaDir);
  fs.mkdir(output);
  const posts = readPosts(fs, dir);
  const pending = posts.filter((post) => !isPostComplete(post, (path) => {
    const bytes = fs.readBytes(join(output, path));
    return bytes !== null && bytes.length > 0;
  }));
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let last: string | null = null;
  const total = pending.reduce((sum, post) => sum + mediaJobs(post).length, 0);
  reporter.update({ phase: "media " + input.key, done: 0, total });

  try {
    outer: for (const post of pending) {
      if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "media.download");
      let effective = post;
      if (post.media.length === 0) {
        const resolved = await client.postPage(post.shortcode, signal);
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
        }
      }
      if (effective.postType === "video" && effective.media.length === 1) {
        const finalPath = join(output, post.shortcode + ".mp4");
        const existing = fs.readBytes(finalPath);
        if (existing === null || existing.length === 0) {
          const tracks = await client.hqTracks(post.shortcode, signal);
          if (tracks !== null) {
            const videoPart = join(output, post.shortcode + ".hqvideo.part");
            const audioPart = join(output, post.shortcode + ".hqaudio.part");
            try {
              fs.writeAtomicBytes(videoPart, await client.mediaBytes(tracks.videoUrl, signal));
              fs.writeAtomicBytes(audioPart, await client.mediaBytes(tracks.audioUrl, signal));
              const muxed = muxVideoAudio(fs, videoPart, audioPart, finalPath);
              if (muxed.ok) {
                downloaded++;
                last = post.shortcode;
                reporter.update({ phase: "media " + input.key, done: downloaded, total, note: post.shortcode + " (HQ)" });
              } else {
                failed++;
                reporter.update({ phase: "media " + input.key, done: downloaded + failed, total, note: post.shortcode + " mux failed" });
              }
            } catch (error) {
              if (error instanceof InstagramRequestFailure && error.kind !== "stopped") {
                onPark(error, input.key, last);
                throw error;
              }
              if (error instanceof InstagramRequestFailure) throw error;
              failed++;
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
        const existing = fs.readBytes(path);
        if (existing !== null && existing.length > 0) {
          skipped++;
          reporter.update({ phase: "media " + input.key, done: downloaded + skipped, total });
          continue;
        }
        try {
          const bytes = await client.mediaBytes(job.ref.url, signal);
          if (bytes.length === 0) throw new Error("empty response body");
          fs.writeAtomicBytes(path, bytes);
          downloaded++;
          last = post.shortcode;
        } catch (error) {
          if (error instanceof InstagramRequestFailure && error.kind !== "stopped") {
            onPark(error, input.key, last);
            throw error;
          }
          if (error instanceof InstagramRequestFailure) throw error;
          failed++;
        }
        reporter.update({ phase: "media " + input.key, done: downloaded + skipped + failed, total, note: post.shortcode });
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
      const bytes = fs.readBytes(join(output, path));
      return bytes !== null && bytes.length > 0;
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
