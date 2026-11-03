import { Effect } from "effect";
import { createActionRevert } from "../../lib/action-revert.ts";
import { fetchResourceBytes } from "./fetch-resource.ts";
import { createArchiveBlobUrl } from "./offscreen-download.ts";
import { capturePolicy } from "./policy.ts";
import { saveTab, type SaveDependencies } from "./workflow.ts";

export interface OnefileActionState {
  tabId: number;
  title: string;
  badge: string;
}

export interface OnefileBackgroundOptions {
  setActionState: (state: OnefileActionState) => void;
  clearActionState: (tabId: number) => void;
}

export interface OnefileBackground {
  save: (tab: chrome.tabs.Tab) => Promise<void>;
  forget: (tabId: number) => void;
}

export function createOnefileBackground(
  options: OnefileBackgroundOptions,
): OnefileBackground {
  const inFlight = new Map<number, string>(),
    titleRevert = createActionRevert();

  let cachedLoaderSource: Promise<string> | null = null;

  function loadLoaderSource(): Promise<string> {
    if (!cachedLoaderSource) {
      cachedLoaderSource = globalThis.fetch(chrome.runtime.getURL("inject/onefile/loader.js")).then((response) => {
        if (!response.ok) throw new Error(`Loader bundle answered HTTP ${response.status}.`);
        return response.text();
      });
      cachedLoaderSource.catch(() => {
        cachedLoaderSource = null;
      });
    }
    return cachedLoaderSource;
  }

  function dependencies(): SaveDependencies {
    return {
      executeCapture: async (tabId, saveId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          injectImmediately: true,
          files: ["inject/onefile/capture.js"],
        }).then(async () => {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            injectImmediately: true,
            func: (stamp: string, nowMs: number) =>
              (globalThis as unknown as { onefileCapture: (stamp: string, nowMs: number) => unknown }).onefileCapture(
                stamp,
                nowMs,
              ),
            args: [saveId, Date.now()],
          });
          return result?.result;
        }),
      fetchResource: (url) => fetchResourceBytes(url),
      downloadBlob: async (blob, filename) => {
        const url = await createArchiveBlobUrl(
          await blob.arrayBuffer(),
          blob.type || "application/octet-stream",
        );
        return chrome.downloads.download({
          url,
          filename,
          saveAs: false,
          conflictAction: "uniquify",
        });
      },
      loadLoaderSource,
      setActionState: async (tabId, title, badge) => {
        options.setActionState({ tabId, title, badge });
      },
      log: (...args) => {
        console.warn(...args);
      },
      nowMs: () => Date.now(),
    };
  }

  async function save(tab: chrome.tabs.Tab): Promise<void> {
    if (tab.id === undefined) return;
    const tabId = tab.id,
      generation = titleRevert.begin(tabId);
    try {
      await Effect.runPromise(
        saveTab(
          { id: tab.id, url: tab.url, title: tab.title },
          dependencies(),
          inFlight,
        ),
      );
      titleRevert.schedule(
        tabId,
        generation,
        (callback, delayMs) => setTimeout(callback, delayMs),
        capturePolicy.saveTitleRevertMs,
        () => options.clearActionState(tabId),
      );
    } catch (error) {
      console.warn("Onefile save failed", error);
    }
  }

  return {
    save,
    forget: (tabId) => titleRevert.forget(tabId),
  };
}
