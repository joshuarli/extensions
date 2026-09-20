import type {
  BackgroundDependencies,
  PageData,
  ResolveTranscriptOutput,
  TranscriptPanelData,
} from "./types.ts";
import { buildMarkdown } from "./metadata.ts";
import { collectPageData, collectTranscriptPanel, updatePageProgress } from "./page.ts";
import {
  fetchPlayerData,
  fetchTranscript as fetchTranscriptApi,
  getCaptionTracks,
} from "./youtube-api.ts";
import { pickCaptionTrack } from "./captions.ts";
import { resolveTranscript } from "./workflow.ts";
import {
  CaptionFetchError,
  InvalidPageError,
  PlayerDataError,
  TabNotAccessibleError,
} from "./error.ts";
import { cachedFetch, clearResponseCache } from "./http.ts";

async function resolveTranscriptForTab(
  tab: chrome.tabs.Tab,
  deps: BackgroundDependencies,
): Promise<ResolveTranscriptOutput> {
  const videoId = requireYouTubeVideo(tab);
  await deps.progress(tab.id!, "Reading YouTube page…");
  await deps.setTitle(tab.id!, "Fetching transcript…");

  const pageData = await deps.readPageData(tab.id!);
  await deps.progress(tab.id!, "Fetching transcript…");
  const settings = await deps.getSettings(),
    preferredLanguage = settings.language.trim() || undefined;
  return resolveTranscript({
    fetchTranscript: (chapters) =>
      deps.fetchTranscript(videoId, pageData, preferredLanguage, chapters, deps.fetch),
    pageData,
    ...(preferredLanguage ? { preferredLanguage } : {}),
    readPanel: () => deps.readPanel(tab.id!),
    tabUrl: tab.url!,
  });
}

export async function handleActionClick(
  tab: chrome.tabs.Tab,
  overrides: Partial<BackgroundDependencies> = {},
): Promise<ResolveTranscriptOutput> {
  const deps = { ...defaultDependencies(), ...overrides };
  try {
    const result = await resolveTranscriptForTab(tab, deps);
    await deps.progress(tab.id!, "Copying transcript…");
    await deps.copy(tab.id!, buildMarkdown(result.metadata, result.transcript.text));
    await deps.setTitle(tab.id!, "Transcript copied");
    await deps.notify("YouTube Transcript Copier", "Transcript copied to the clipboard.");
    await deps.progress(tab.id!, "Transcript copied.", true);
    deps.schedule(() => deps.setTitle(tab.id!, "Copy YouTube transcript"), 2500);
    return result;
  } catch (error) {
    deps.log("YouTube Transcript Copier:", error as Error);
    if (tab.id!) {
      await deps.setTitle(tab.id!, "Copy failed");
      await deps.notify(
        "YouTube Transcript Copier",
        (error as Error).message || "Could not copy the transcript.",
      );
      deps.schedule(() => deps.setTitle(tab.id!, "Copy YouTube transcript"), 2500);
    }
    throw error;
  }
}

export async function handleActionClickSrt(
  tab: chrome.tabs.Tab,
  overrides: Partial<BackgroundDependencies> = {},
): Promise<ResolveTranscriptOutput> {
  const deps = { ...defaultDependencies(), ...overrides };
  try {
    const result = await resolveTranscriptForTab(tab, deps);
    await deps.progress(tab.id!, "Copying SRT subtitles…");
    await deps.copy(tab.id!, result.transcript.srt);
    await deps.setTitle(tab.id!, "SRT subtitles copied");
    await deps.notify("YouTube Transcript Copier", "SRT subtitles copied to the clipboard.");
    await deps.progress(tab.id!, "SRT subtitles copied.", true);
    deps.schedule(() => deps.setTitle(tab.id!, "Copy YouTube transcript"), 2500);
    return result;
  } catch (error) {
    deps.log("YouTube Transcript Copier:", error as Error);
    if (tab.id!) {
      await deps.setTitle(tab.id!, "Copy failed");
      await deps.notify(
        "YouTube Transcript Copier",
        (error as Error).message || "Could not copy the SRT subtitles.",
      );
      deps.schedule(() => deps.setTitle(tab.id!, "Copy YouTube transcript"), 2500);
    }
    throw error;
  }
}

export async function handleGetTranscript(
  tab: chrome.tabs.Tab,
  overrides: Partial<BackgroundDependencies> = {},
): Promise<string> {
  const deps = { ...defaultDependencies(), ...overrides },
    result = await resolveTranscriptForTab(tab, deps);
  return buildMarkdown(result.metadata, result.transcript.text);
}

export async function handleGetSubtitle(
  tab: chrome.tabs.Tab,
  overrides: Partial<BackgroundDependencies> = {},
): Promise<string> {
  const deps = { ...defaultDependencies(), ...overrides },
    result = await resolveTranscriptForTab(tab, deps);
  return result.transcript.srt;
}

export const handleDownloadFixtures:
  | ((
      tab: chrome.tabs.Tab,
      overrides?: Partial<BackgroundDependencies>,
    ) => Promise<{ label: string }>)
  | undefined =
  process.env["NODE_ENV"] === "production"
    ? undefined
    : async (
        tab: chrome.tabs.Tab,
        overrides: Partial<BackgroundDependencies> = {},
      ): Promise<{ label: string }> => {
        const deps = { ...defaultDependencies(), ...overrides },
          videoId = requireYouTubeVideo(tab);
        await deps.progress(tab.id!, "Reading YouTube page…");
        const pageData = await deps.readPageData(tab.id!),
          settings = await deps.getSettings(),
          preferredLanguage = settings.language.trim() || undefined;

        await deps.progress(tab.id!, "Fetching InnerTube response…");
        const playerData = await fetchPlayerData(videoId, preferredLanguage, deps.fetch);
        if (!playerData) {
          throw new PlayerDataError(
            "YouTube did not return player data. The video may be unavailable or the request may be blocked.",
          );
        }
        const nextData = await fetchNextResponse!(videoId, preferredLanguage, deps.fetch),
          tracks = getCaptionTracks(playerData),
          track = pickCaptionTrack(tracks, preferredLanguage);
        if (!track?.baseUrl) {
          throw new CaptionFetchError("No captions are available for this video.");
        }
        await deps.progress(tab.id!, "Downloading captions…");
        const xml = await fetchRawCaptionXml!(track as { baseUrl: string }, deps.fetch);

        await deps.progress(tab.id!, "Building transcript…");
        const result = await resolveTranscript({
            fetchTranscript: (chapters) =>
              deps.fetchTranscript(
                videoId,
                { ...pageData, playerResponse: playerData },
                preferredLanguage,
                chapters,
                deps.fetch,
              ),
            pageData: { ...pageData, initialData: nextData, playerResponse: playerData },
            ...(preferredLanguage ? { preferredLanguage } : {}),
            readPanel: () => deps.readPanel(tab.id!),
            tabUrl: tab.url!,
          }),
          prefix = `${videoId}-`,
          innertube = JSON.stringify(
            sortKeys!({
              fetchedAt: new Date().toISOString(),
              nextResponse: nextData,
              playerResponse: playerData,
              videoId,
            }),
          ),
          innertubeGzip = await gzip!(innertube);
        await deps.progress(tab.id!, "Saving fixtures…");
        await deps.download!(`${prefix}innertube.json.gz`, innertubeGzip, "application/gzip");
        await deps.download!(
          `${prefix}transcript.md`,
          buildMarkdown(result.metadata, result.transcript.text),
          "text/markdown",
        );
        await deps.download!(
          `${prefix}transcript.srt`,
          result.transcript.srt,
          "application/octet-stream",
        );
        await deps.download!(`${prefix}caption.xml`, xml, "application/xml");
        await deps.progress(tab.id!, "Fixtures downloaded.", true);
        return { label: "Fixtures downloaded!" };
      };

function defaultDependencies(): BackgroundDependencies {
  return {
    copy: (tabId: number, text: string): Promise<void> =>
      chrome.scripting
        .executeScript({
          args: [text],
          func: async (value: string) => {
            try {
              await navigator.clipboard.writeText(value);
            } catch {
              const textarea = document.createElement("textarea");
              textarea.value = value;
              textarea.style.position = "fixed";
              textarea.style.opacity = "0";
              document.body.append(textarea);
              textarea.select();
              if (!document.execCommand("copy"))
                throw new Error(
                  "Could not copy to the clipboard. Check the extension clipboard permission and try again.",
                );
              textarea.remove();
            }
          },
          target: { tabId },
        })
        .then(() => {}),
    download: async (
      filename: string,
      content: Uint8Array | string,
      type?: string,
    ): Promise<void> => {
      let url: string;
      if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
        const bytes = new Uint8Array(content),
          blob = new Blob([bytes], type === undefined ? {} : { type });
        url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(reader.result as string));
          reader.addEventListener("error", () => reject(reader.error));
          reader.readAsDataURL(blob);
        });
      } else {
        url = `data:${type};charset=utf-8,${encodeURIComponent(content)}`;
      }
      await chrome.downloads.download({ filename, saveAs: false, url });
    },
    fetch: cachedFetch(globalThis.fetch.bind(globalThis) as typeof globalThis.fetch),
    fetchTranscript: fetchTranscriptApi,
    getSettings: (): Promise<{ language: string }> => chrome.storage.local.get({ language: "" }),
    log: (...args: unknown[]) => console.error(...args),
    notify: (title: string, message: string) => notifySafely(title, message),
    progress: (tabId: number, message: string, done = false): Promise<void> =>
      sendProgress(tabId, message, done),
    readPageData: (tabId: number): Promise<PageData> => executePageScript(tabId, collectPageData),
    readPanel: (tabId: number): Promise<TranscriptPanelData | null> =>
      executePageScript(tabId, collectTranscriptPanel).then(
        (r) => r as unknown as TranscriptPanelData | null,
      ),
    schedule: (callback: () => void, delay: number) => {
      setTimeout(callback, delay);
    },
    setTitle: (tabId: number, title: string): Promise<void> =>
      chrome.action.setTitle({ tabId, title }).catch(() => {}),
  };
}

const fetchRawCaptionXml:
    | ((track: { baseUrl: string }, fetchImpl: typeof globalThis.fetch) => Promise<string>)
    | undefined =
    process.env["NODE_ENV"] === "production"
      ? undefined
      : async (track: { baseUrl: string }, fetchImpl: typeof globalThis.fetch) => {
          const url = new URL(track.baseUrl);
          if (!url.hostname.endsWith(".youtube.com")) {
            throw new CaptionFetchError("Invalid caption URL.");
          }
          let response;
          try {
            response = await fetchImpl(track.baseUrl, {
              headers: { "User-Agent": "Mozilla/5.0" },
              signal: AbortSignal.timeout(4000),
            });
            if (!response.ok) {
              throw new CaptionFetchError(`HTTP ${response.status || "error"}`);
            }
            return await response.text();
          } catch (error) {
            if ((error as Error).message?.startsWith("HTTP ")) {
              throw new CaptionFetchError(
                `YouTube rejected the caption request (${(error as Error).message}).`,
              );
            }
            throw new CaptionFetchError(
              "Could not download captions from YouTube. The request may be blocked or timed out.",
            );
          }
        },
  fetchNextResponse:
    | ((
        videoId: string,
        preferredLanguage: string | undefined,
        fetchImpl: typeof globalThis.fetch,
      ) => Promise<unknown>)
    | undefined =
    process.env["NODE_ENV"] === "production"
      ? undefined
      : async (
          videoId: string,
          preferredLanguage: string | undefined,
          fetchImpl: typeof globalThis.fetch,
        ) => {
          try {
            const response = await fetchImpl(
              "https://www.youtube.com/youtubei/v1/next?prettyPrint=false",
              {
                body: JSON.stringify({
                  context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
                  videoId,
                }),
                headers: {
                  "Content-Type": "application/json",
                  ...(preferredLanguage ? { "Accept-Language": preferredLanguage } : {}),
                },
                method: "POST",
                signal: AbortSignal.timeout(4000),
              },
            );
            return response.ok ? await response.json() : null;
          } catch {
            return null;
          }
        },
  sortKeys: ((obj: unknown) => unknown) | undefined =
    process.env["NODE_ENV"] === "production"
      ? undefined
      : (obj) => {
          const seen = new WeakSet<object>(),
            walk = (val: unknown): unknown => {
              if (!val || typeof val !== "object") {
                return val;
              }
              if (seen.has(val as object)) {
                return val;
              }
              seen.add(val as object);
              if (Array.isArray(val)) {
                return val.map((v) => walk(v));
              }
              return Object.keys(val as Record<string, unknown>)
                .toSorted()
                .reduce<Record<string, unknown>>((acc, key) => {
                  acc[key] = walk((val as Record<string, unknown>)[key]);
                  return acc;
                }, {});
            };
          return walk(obj);
        },
  gzip: ((data: string) => Promise<Uint8Array>) | undefined =
    process.env["NODE_ENV"] === "production"
      ? undefined
      : async (data) => {
          const compressed = new Blob([new TextEncoder().encode(data)])
            .stream()
            .pipeThrough(new CompressionStream("gzip"));
          return new Uint8Array(await new Response(compressed).arrayBuffer());
        };

function requireYouTubeVideo(tab: chrome.tabs.Tab): string {
  if (!tab?.id || !isYouTubeUrl(tab.url!)) {
    throw new InvalidPageError("Open a YouTube video first.", tab.url || "");
  }
  const videoId = getVideoId(tab.url!);
  if (!videoId) {
    throw new InvalidPageError("Open a YouTube watch page with a valid video ID.", tab.url || "");
  }
  return videoId;
}

function sendProgress(tabId: number, message: string, done?: boolean): Promise<void> {
  return chrome.scripting
    .executeScript({
      args: [message, done],
      func: updatePageProgress,
      target: { tabId },
    })
    .then(() => {})
    .catch(() => {});
}

async function notifySafely(title: string, message: string): Promise<void> {
  try {
    await chrome.notifications.create({
      iconUrl: chrome.runtime.getURL("icon.svg"),
      message,
      title,
      type: "basic",
    });
  } catch (error) {
    console.warn("YouTube Transcript notification failed:", error as Error);
  }
}

function executePageScript<T>(tabId: number, func: () => T): Promise<T> {
  return chrome.scripting.executeScript({ func, target: { tabId } }).then((results) => {
    const result = results[0]?.result;
    return (result === undefined ? {} : result) as T;
  });
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

export function getVideoId(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1).split("/")[0] || "";
  }
  if (parsed.pathname.includes("/shorts/")) {
    return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
  }
  return parsed.searchParams.get("v") || "";
}

if (typeof chrome !== "undefined") {
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.runtime.onMessageExternal.addListener(handleMessage);
  chrome.tabs.onRemoved.addListener(() => clearResponseCache());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "loading") {
      clearResponseCache();
    }
  });
}

function handleMessage(
  message: { action: string; tabId?: number },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): true {
  (async () => {
    try {
      console.log("YouTube Transcript: received action", message.action);
      const tab = message.tabId ? await chrome.tabs.get(message.tabId) : _sender.tab;
      if (!tab) {
        throw new TabNotAccessibleError("Tab not found.");
      }

      let result;
      switch (message.action) {
        case "copyTranscript": {
          await handleActionClick(tab);
          result = { label: "Transcript copied!" };
          break;
        }
        case "copySrt": {
          await handleActionClickSrt(tab);
          result = { label: "SRT subtitles copied!" };
          break;
        }
        case "getTranscript": {
          result = { transcript: await handleGetTranscript(tab) };
          break;
        }
        case "getSubtitle": {
          result = { transcript: await handleGetSubtitle(tab) };
          break;
        }
        case "downloadFixtures": {
          if (process.env["NODE_ENV"] === "production") {
            result = { error: "Fixtures download is only available in development builds." };
          } else {
            result = await handleDownloadFixtures!(tab);
          }
          break;
        }
        default: {
          result = { error: `Unknown action: ${message.action}` };
        }
      }
      sendResponse(result);
    } catch (error) {
      console.error("YouTube Transcript background error:", error);
      if (message.tabId) {
        await sendProgress(
          message.tabId,
          `Failed: ${(error as Error).message || "Unknown error."}`,
          true,
        );
      }
      const err = error as Error;
      sendResponse({
        error: err.message || "Unknown error.",
        errorDetail: err.stack || err.message,
      });
    }
  })();
  return true;
}
