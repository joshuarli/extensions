import { join } from "node:path";
import { renderCollection, renderIndex, SITE_CSS, type CollectionState } from "../../instagram-archive-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";
import type { ArchiveFs } from "./fs.ts";
import { collectionDir, readPosts, readState } from "./store.ts";

export interface BuildSummary {
  readonly collections: number;
  readonly posts: number;
  readonly indexPath: string;
}

export function buildSite(fs: ArchiveFs, outRoot: string, reporter: ProgressReporter): BuildSummary {
  const states: CollectionState[] = [];
  let posts = 0;
  for (const accountFolder of fs.listDirs(outRoot)) {
    if (!accountFolder.startsWith("ig-")) continue;
    const accountRoot = join(outRoot, accountFolder);
    for (const key of fs.listDirs(join(accountRoot, "collections"))) {
      const dir = collectionDir(accountRoot, key);
      const state = readState(fs, dir, key.endsWith("-saved") ? "saved" : "profile", key);
      const collectionPosts = readPosts(fs, dir);
      const page = renderCollection({ state, posts: collectionPosts });
      for (const [name, content] of Object.entries(page.files)) {
        fs.writeText(join(dir, name), content);
      }
      fs.writeText(join(dir, "site.css"), SITE_CSS);
      states.push(state);
      posts += page.count;
      reporter.update({ phase: "build", done: states.length, total: states.length, note: key });
    }
  }
  const indexPath = join(outRoot, "index.html");
  fs.writeText(indexPath, renderIndex(states));
  fs.writeText(join(outRoot, "site.css"), SITE_CSS);
  reporter.finish("built " + states.length + " collections, " + posts + " posts");
  return { collections: states.length, posts, indexPath };
}
