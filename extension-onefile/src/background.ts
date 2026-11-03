import { Effect } from "effect";
import { fetchResourceBytes } from "./fetch-resource.ts";
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
}

const offscreenPath = "features/onefile/offscreen.html";

let offscreenQueue: Promise<void> = Promise.resolve();

interface OffscreenWindowClient {
  url: string;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

interface OffscreenClients {
  matchAll: (options: {
    includeUncontrolled: boolean;
    type: "window";
  }) => Promise<OffscreenWindowClient[]>;
}

function ensureOffscreenDocument(): Promise<void> {
  const next = offscreenQueue.then(async () => {
    const offscreenUrl = chrome.runtime.getURL(offscreenPath);
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: offscreenPath,
        reasons: ["BLOBS"],
        justification: "Create a blob URL for a large archive download.",
      });
    }
  });
  offscreenQueue = next.catch(() => undefined);
  return next;
}

async function createArchiveBlobUrl(bytes: ArrayBuffer, type: string): Promise<string> {
  await ensureOffscreenDocument();
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);
  const clients = await (globalThis as unknown as { clients: OffscreenClients }).clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  const client = clients.find((candidate) => candidate.url === offscreenUrl);
  if (!client) throw new Error("Onefile offscreen document is unavailable.");

  const channel = new MessageChannel();
  const url = new Promise<string>((resolve, reject) => {
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === "string") {
        resolve(event.data);
      } else {
        reject(new Error("Onefile offscreen document returned an invalid URL."));
      }
    };
    channel.port1.onmessageerror = () =>
      reject(new Error("Onefile offscreen message failed."));
  });

  const buffer = bytes;
  client.postMessage(
    { kind: "onefile/blob-url", bytes: buffer, type },
    [buffer, channel.port2],
  );
  return url;
}

export function createOnefileBackground(
  options: OnefileBackgroundOptions,
): OnefileBackground {
  const inFlight = new Map<number, string>();

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
    const tabId = tab.id;
    try {
      await Effect.runPromise(
        saveTab(
          { id: tab.id, url: tab.url, title: tab.title },
          dependencies(),
          inFlight,
        ),
      );
      setTimeout(() => {
        options.clearActionState(tabId);
      }, capturePolicy.saveTitleRevertMs);
    } catch (error) {
      console.warn("Onefile save failed", error);
    }
  }

  return { save };
}
