import { Effect } from "effect";
import { fetchThread } from "../../hackernews-archive-core/src/client.ts";
import { renderThread } from "../../hackernews-archive-core/src/render.ts";
import { HnArchiveError, threadId } from "../../hackernews-archive-core/src/thread.ts";
import { createArchiveBlobUrl } from "../../extension-onefile/src/offscreen-download.ts";

const inFlight = new Set<number>();

type CaptureStatus = { readonly title: string; readonly badge: string; readonly badgeColor: string };

export async function saveHackerNewsThread(
  tab: chrome.tabs.Tab,
  expectedId: number,
  setStatus: (tabId: number, state: CaptureStatus) => void,
): Promise<void> {
  const id = threadId(tab.url ?? ""), tabId = tab.id;
  if (id === undefined || tabId === undefined) throw new HnArchiveError("Open a Hacker News discussion first.");
  if (id !== expectedId) throw new HnArchiveError("The active Hacker News item changed; reopen the popup.");
  if (inFlight.has(id)) throw new HnArchiveError("This Hacker News item is already being archived.");
  inFlight.add(id);
  // Keep final feedback on the original tab even if the popup closes, but never on a different item.
  async function report(state: CaptureStatus): Promise<void> {
    try {
      const current = await chrome.tabs.get(tabId!);
      if (threadId(current.url ?? "") === id) setStatus(tabId!, state);
    } catch {
      // Tab closed or access revoked. A download may still succeed.
    }
  }
  // Chrome resets the worker idle timer on extension API calls. Bound this to the active capture.
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, 20_000);
  try {
    setStatus(tabId, { title: "Archiving Hacker News discussion…", badge: "HN", badgeColor: "#ad5700" });
    const archive = await Effect.runPromise(fetchThread(id));
    const filename = `hn-${archive.rootId}.html`;
    await Effect.runPromise(Effect.tryPromise({
      try: async () => {
        const bytes = new TextEncoder().encode(renderThread(archive));
        const blob = await createArchiveBlobUrl(bytes.slice().buffer, "text/html;charset=utf-8");
        try {
          await chrome.downloads.download({
            url: blob.url, filename, saveAs: false, conflictAction: "uniquify",
          });
        } finally {
          blob.release();
        }
      },
      catch: (error) => new HnArchiveError(`HN archive download failed: ${String(error)}`),
    }));
    await report({ title: `HN archive download started: ${filename}`, badge: "OK", badgeColor: "#188038" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await report({ title: `HN archive failed: ${message.slice(0, 200)}`, badge: "!", badgeColor: "#c5221f" });
    throw error;
  } finally {
    clearInterval(keepAlive);
    inFlight.delete(id);
  }
}
