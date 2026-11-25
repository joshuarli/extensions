import type { MediaRef, Post } from "./types.ts";

export interface MediaJob {
  readonly shortcode: string;
  readonly index: number;
  readonly ref: MediaRef;
  readonly path: string;
}

function extension(ref: MediaRef): string {
  return ref.kind === "video" ? ".mp4" : ".jpg";
}

export function mediaPaths(post: Post): string[] {
  if (post.media.length === 1) return [post.shortcode + extension(post.media[0]!)];
  return post.media.map((ref, index) => post.shortcode + "_" + (index + 1) + extension(ref));
}

export function mediaJobs(post: Post): MediaJob[] {
  const paths = mediaPaths(post);
  return post.media.map((ref, index) => ({
    shortcode: post.shortcode,
    index,
    ref,
    path: paths[index]!,
  }));
}

export function isPostComplete(post: Post, exists: (path: string) => boolean): boolean {
  if (post.media.length === 0) return false;
  return mediaPaths(post).every((path) => exists(path));
}

export function countMedia(posts: readonly Post[]): number {
  return posts.reduce((total, post) => total + post.media.length, 0);
}
