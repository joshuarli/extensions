import type { PageData, TranscriptPanelData, TranscriptSegment } from "./types.ts";

function parseTimestamp(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n)) || (parts.length !== 2 && parts.length !== 3)) {
    return null;
  }
  const [first = 0, second = 0, third = 0] = parts;
  return parts.length === 3 ? first * 3600 + second * 60 + third : first * 60 + second;
}

function readLanguageCode(page: Document | typeof document): string | undefined {
  const button = page.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #footer yt-dropdown-menu button',
    ),
    text = button?.textContent?.trim();
  return text || undefined;
}

function readSegments(root: Element): TranscriptSegment[] {
  const desktopSegments = [...root.querySelectorAll("ytd-transcript-segment-renderer")],
    mobileSegments = [...root.querySelectorAll("transcript-segment-view-model")],
    raw: { start: number | null; text: string }[] =
      desktopSegments.length > 0
        ? desktopSegments.map((segment) => ({
            start: parseTimestamp(segment.querySelector(".segment-timestamp")?.textContent || ""),
            text: segment.querySelector(".segment-text")?.textContent?.trim() || "",
          }))
        : mobileSegments.map((segment) => ({
            start: parseTimestamp(
              segment.querySelector(".ytwTranscriptSegmentViewModelTimestamp")?.textContent || "",
            ),
            text:
              segment.querySelector("span.yt-core-attributed-string")?.textContent?.trim() || "",
          }));
  return raw.filter(
    (segment): segment is { start: number; text: string } =>
      segment.start !== null && Boolean(segment.text),
  );
}

async function waitFor<T>(
  predicate: () => T,
  attempts = 20,
): Promise<Exclude<T, false | null | undefined> | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = predicate();
    if (result) {
      return result as Exclude<T, false | null | undefined>;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export function collectPageData(doc: Document | typeof document = document): PageData {
  const parseGlobal = (name: string): Record<string, unknown> | null => {
      const script = [...doc.scripts].find((item) => item.textContent?.includes(name));
      if (!script?.textContent) {
        return null;
      }
      const source = script.textContent,
        start = source.indexOf("{", source.indexOf(name));
      if (start === -1) {
        return null;
      }
      let depth = 0;
      for (let index = start; index < source.length; index++) {
        if (source[index] === "{") {
          depth++;
        }
        if (source[index] === "}") {
          depth--;
        }
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
      return null;
    },
    getVideoId = (url: string): string => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || "";
        if (parsed.pathname.includes("/shorts/"))
          return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
        return parsed.searchParams.get("v") || "";
      } catch {
        return "";
      }
    },
    playerResponse = parseGlobal("ytInitialPlayerResponse"),
    initialData = parseGlobal("ytInitialData");
  let videoObject = [...doc.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => {
      try {
        const value = JSON.parse(script.textContent || "null") as unknown;
        return Array.isArray(value) ? (value as Record<string, unknown>[]) : [value];
      } catch {
        return [];
      }
    })
    .find((value) => {
      const obj = value as Record<string, unknown>;
      return obj?.["@type"] === "VideoObject";
    }) as Record<string, unknown> | undefined;
  const playerMicroformat = playerResponse?.["microformat"] as Record<string, unknown> | undefined;
  let playerMicroformatRenderer = playerMicroformat?.["playerMicroformatRenderer"] as
      | Record<string, unknown>
      | undefined,
    videoDetails = playerResponse?.["videoDetails"] as Record<string, unknown> | undefined;

  const playerVideoId = videoDetails?.["videoId"] as string | undefined;
  if (playerVideoId && playerVideoId !== getVideoId(doc.URL)) {
    videoObject = undefined;
    videoDetails = undefined;
    playerMicroformatRenderer = undefined;
  }

  const thumbnail = videoDetails?.["thumbnail"] as Record<string, unknown> | undefined,
    thumbnails = (thumbnail?.["thumbnails"] as Record<string, unknown>[]) || [],
    author =
      ((videoObject?.["author"] as Record<string, unknown> | undefined)?.["name"] as
        | string
        | undefined) ||
      (videoDetails?.["author"] as string | undefined) ||
      (videoDetails?.["ownerChannelName"] as string | undefined) ||
      (playerMicroformatRenderer?.["ownerChannelName"] as string | undefined) ||
      doc
        .querySelector("#owner-name a, ytd-video-owner-renderer #channel-name a")
        ?.textContent?.trim() ||
      "",
    metadata = {
      author,
      description:
        (videoObject?.["description"] as string | undefined) ||
        ((playerMicroformatRenderer?.["description"] as Record<string, unknown> | undefined)?.[
          "simpleText"
        ] as string | undefined) ||
        (doc.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content ||
        "",
      image:
        (Array.isArray(videoObject?.["thumbnailUrl"])
          ? (videoObject["thumbnailUrl"] as string[])[0]
          : (videoObject?.["thumbnailUrl"] as string | undefined) ||
            (thumbnails.at(-1)?.["url"] as string | undefined) ||
            (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content) ||
        "",
      language: "",
      published:
        (videoObject?.["uploadDate"] as string | undefined) ||
        (playerMicroformatRenderer?.["publishDate"] as string | undefined) ||
        "",
      site: "YouTube",
      title:
        (videoObject?.["name"] as string | undefined) ||
        (videoDetails?.["title"] as string | undefined) ||
        (doc.querySelector('meta[property="og:title"]') as HTMLMetaElement | null)?.content ||
        doc.title.replace(/\s+-\s+YouTube\s*$/u, ""),
    },
    desktop =
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #segments-container',
    mobile = "ytm-macro-markers-list-renderer .ytm-macro-markers-list-container",
    container = doc.querySelector(desktop) || doc.querySelector(mobile);
  if (!container) {
    return { initialData, metadata, playerResponse, transcript: null };
  }

  const segments = readSegments(container);
  if (segments.length === 0) {
    return { initialData, metadata, playerResponse, transcript: null };
  }
  const languageCode = readLanguageCode(doc);
  return {
    initialData,
    metadata,
    playerResponse,
    transcript: {
      ...(languageCode ? { languageCode } : {}),
      segments,
    },
  };
}

export function updatePageProgress(message: string, done: boolean = false): void {
  const tagName = "youtube-transcript-progress";
  let host = document.querySelector(tagName);
  if (!host) {
    host = document.createElement(tagName);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .mask {
          background: rgb(0 0 0 / 30%);
          inset: 0;
          position: fixed;
          z-index: 2147483646;
        }
        .logs {
          background: #fff;
          bottom: 24px;
          box-shadow: 0 2px 10px rgb(0 0 0 / 28%);
          color: #202124;
          font: 13px Arial, sans-serif;
          left: 8px;
          min-width: 260px;
          padding: 4px;
          position: fixed;
          z-index: 2147483647;
        }
        .line {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
          padding: 4px 6px;
        }
        .line + .line { border-top: 1px solid #eee; }
        .message { flex: 1; }
        .status { color: #5f6368; min-width: 12px; text-align: center; }
        .current .status { animation: pulse 1s ease-in-out infinite alternate; }
        .complete .message, .complete .status { opacity: .55; }
        .error .status { color: #c5221f; }
        @keyframes pulse { from { opacity: .3; } to { opacity: 1; } }
      </style>
      <div class="mask"></div>
      <div class="logs" role="status" aria-live="polite"></div>`;
    document.documentElement.append(host);
  }

  const logs = host.shadowRoot!.querySelector<HTMLDivElement>(".logs")!,
    previous = logs.querySelector<HTMLDivElement>(".current");
  if (previous) {
    previous.classList.remove("current");
    previous.classList.add("complete");
    previous!.querySelector<HTMLSpanElement>(".status")!.textContent = "✓";
  }
  const line = document.createElement("div"),
    failed = message.startsWith("Failed:");
  line.className = `line ${done ? "complete" : "current"}${failed ? " error" : ""}`;
  line.innerHTML = `<span class="message"></span><span class="status">${done ? (failed ? "!" : "✓") : "…"}</span>`;
  line.querySelector<HTMLSpanElement>(".message")!.textContent = message;
  logs.append(line);
  if (done) {
    setTimeout(() => host.remove(), 1800);
  }
}

export async function collectTranscriptPanel(
  doc: Document | typeof document = document,
): Promise<TranscriptPanelData | null> {
  const desktopContainer =
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #segments-container',
    mobileContainer = "ytm-macro-markers-list-renderer .ytm-macro-markers-list-container",
    read = (): TranscriptPanelData | null => {
      const container = doc.querySelector(desktopContainer) || doc.querySelector(mobileContainer);
      if (!container) {
        return null;
      }
      const segments = readSegments(container);
      if (segments.length === 0) {
        return null;
      }
      const languageCode = readLanguageCode(doc);
      return { ...(languageCode ? { languageCode } : {}), segments };
    },
    existing = read();
  if (existing) {
    return existing;
  }

  if (doc.querySelector("ytm-slim-video-metadata-section-renderer")) {
    (doc.querySelector('button[aria-label="Show more"]') as HTMLButtonElement | null)?.click();
    const viewAll = await waitFor(() => doc.querySelector('button[aria-label="View all"]'));
    if (!viewAll) {
      return null;
    }
    (viewAll as HTMLButtonElement).click();
    const timeline = await waitFor(() => doc.querySelector('button[aria-label="Timeline"]'));
    if (!timeline) {
      return null;
    }
    (timeline as HTMLButtonElement).click();
  } else {
    const button = doc.querySelector<HTMLButtonElement>(
      "ytd-video-description-transcript-section-renderer button",
    );
    if (!button) {
      return null;
    }
    (button as HTMLButtonElement)!.click();
  }
  return waitFor(read);
}
