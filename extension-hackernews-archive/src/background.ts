import { Effect } from "effect";
import { fetchThread } from "../../hackernews-archive-core/src/client.ts";
import { renderThread } from "../../hackernews-archive-core/src/render.ts";
import { HnArchiveError, threadId } from "../../hackernews-archive-core/src/thread.ts";
import { createArchiveBlobUrl } from "../../extension-onefile/src/offscreen-download.ts";

const inFlight = new Set<number>();

export async function saveHackerNewsThread(tab: chrome.tabs.Tab): Promise<void> {
  const id = threadId(tab.url ?? "");
  if (id === undefined) throw new HnArchiveError("Open a Hacker News discussion first.");
  if (inFlight.has(id)) throw new HnArchiveError("This Hacker News thread is already being archived.");
  inFlight.add(id);
  // Chrome resets the worker idle timer on extension API calls. Bound this to the active capture.
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, 20_000);
  try {
    const archive = await Effect.runPromise(fetchThread(id));
    await Effect.runPromise(Effect.tryPromise({
      try: async () => {
        const bytes = new TextEncoder().encode(renderThread(archive));
        const blob = await createArchiveBlobUrl(bytes.slice().buffer, "text/html;charset=utf-8");
        try {
          await chrome.downloads.download({
            url: blob.url, filename: `hn-${archive.rootId}.html`, saveAs: false, conflictAction: "uniquify",
          });
        } finally {
          blob.release();
        }
      },
      catch: (error) => new HnArchiveError(`HN archive download failed: ${String(error)}`),
    }));
  } finally {
    clearInterval(keepAlive);
    inFlight.delete(id);
  }
}
