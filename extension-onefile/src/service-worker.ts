import { Effect } from "effect";
import { fetchResourceBytes } from "./fetch-resource.ts";
import { saveTab, scheduleTitleRevert, type SaveDependencies } from "./workflow.ts";

const idleTitle = "Save this page as a universal archive.",
  inFlight = new Map<number, string>();

let cachedLoaderSource: Promise<string> | null = null;

function loadLoaderSource(): Promise<string> {
  if (!cachedLoaderSource) {
    cachedLoaderSource = globalThis.fetch(chrome.runtime.getURL("inject/loader.js")).then((response) => {
      if (!response.ok) throw new Error(`Loader bundle answered HTTP ${response.status}.`);
      return response.text();
    });
    cachedLoaderSource.catch(() => {
      cachedLoaderSource = null;
    });
  }
  return cachedLoaderSource;
}

function realDependencies(): SaveDependencies {
  return {
    executeCapture: async (tabId, saveId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        files: ["inject/capture.js"],
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
    downloadDataUrl: (url, filename) =>
      chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" }),
    loadLoaderSource,
    setActionState: async (tabId, title, badge) => {
      await chrome.action.setTitle({ tabId, title });
      await chrome.action.setBadgeText({ tabId, text: badge });
    },
    log: (...args) => {
      console.warn(...args);
    },
    nowMs: () => Date.now(),
  };
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  void Effect.runPromise(
    saveTab({ id: tab.id, url: tab.url, title: tab.title }, realDependencies(), inFlight).pipe(
      Effect.tap((outcome) =>
        Effect.sync(() => {
          scheduleTitleRevert(
            {
              setActionState: (id, title, badge) =>
                chrome.action.setTitle({ tabId: id, title }).then(() => chrome.action.setBadgeText({ tabId: id, text: badge })),
              log: (...args) => {
                console.warn(...args);
              },
            },
            tabId,
            idleTitle,
          );
          void outcome;
        }),
      ),
    ),
  ).catch((error: unknown) => {
    console.warn("Onefile save failed", error);
  });
});
