import { collectionDir, listCollections, readPosts, SAVED_SUFFIX } from "./store.ts";
import type { ArchiveFs } from "./fs.ts";

export interface ArchiveInfo {
  readonly collections: number;
  readonly posts: number;
  readonly names: readonly string[];
}

export function inspectArchive(fs: ArchiveFs, outRoot: string): ArchiveInfo {
  let collections = 0;
  let posts = 0;
  const names: string[] = [];
  for (const key of listCollections(fs, outRoot)) {
    collections++;
    const found = readPosts(fs, collectionDir(outRoot, key)).length;
    posts += found;
    names.push((key.endsWith(SAVED_SUFFIX) ? "Saved from @" + key.slice(0, -SAVED_SUFFIX.length) : "@" + key) + ": " + found);
  }
  return { collections, posts, names };
}
