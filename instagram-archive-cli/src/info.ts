import { join } from "node:path";
import { readPosts } from "./store.ts";
import type { ArchiveFs } from "./fs.ts";

export interface ArchiveInfo {
  readonly accounts: number;
  readonly collections: number;
  readonly posts: number;
  readonly names: readonly string[];
}

export function inspectArchive(fs: ArchiveFs, outRoot: string): ArchiveInfo {
  let accounts = 0;
  let collections = 0;
  let posts = 0;
  const names: string[] = [];
  for (const folder of fs.listDirs(outRoot)) {
    if (!folder.startsWith("ig-")) continue;
    accounts++;
    const accountRoot = join(outRoot, folder);
    for (const key of fs.listDirs(join(accountRoot, "collections"))) {
      collections++;
      const found = readPosts(fs, join(accountRoot, "collections", key)).length;
      posts += found;
      names.push(folder.slice(3) + "/" + key + ": " + found);
    }
  }
  return { accounts, collections, posts, names };
}
