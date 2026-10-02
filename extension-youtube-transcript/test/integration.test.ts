import type { BackgroundDependencies, PageData, TranscriptResult } from "../src/types.ts";
import { describe, it, test } from "vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  handleActionClick,
  handleActionClickSrt,
  handleDownloadFixtures,
  handleGetSubtitle,
  handleGetTranscript,
  isYouTubeUrl,
  getVideoId,
} from "../src/service-worker.ts";
import { collectPageData } from "../src/page.ts";
import { resolveTranscript } from "../src/workflow.ts";
import { fetchPlayerData, fetchTranscript, getCaptionTracks } from "../src/youtube-api.ts";
import { CaptionFetchError } from "../src/error.ts";

async function decompress(buffer: Uint8Array): Promise<string> {
  const stream = new Blob([buffer as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function transcriptBody(markdown: string): string {
  return markdown.slice(markdown.indexOf("---", 4) + 4).trim();
}

interface FixtureSet {
  videoId: string;
  caption: { xml: string };
  innertube: Record<string, unknown>;
  description: string;
  expectedTranscript: string;
  expectedSrt?: string;
  title: string;
  author: string;
  published: string;
  image: string;
  languageCode: string;
}

async function discoverFixtures(): Promise<FixtureSet[]> {
  const fixtureDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url)),
    files = fs.readdirSync(fixtureDirectory),
    videoIds = [
      ...new Set(
        files
          .filter((f) => f.endsWith("-innertube.json.gz"))
          .map((f) => f.slice(0, -"-innertube.json.gz".length)),
      ),
    ];
  return Promise.all(
    videoIds.map(async (videoId) => {
      const caption = {
          xml: fs.readFileSync(`${fixtureDirectory}${videoId}-caption.xml`, "utf8"),
        },
        innertube = JSON.parse(
          await decompress(fs.readFileSync(`${fixtureDirectory}${videoId}-innertube.json.gz`)),
        ) as Record<string, unknown>,
        playerResponse = innertube["playerResponse"] as Record<string, unknown>,
        videoDetails = playerResponse["videoDetails"] as Record<string, unknown>,
        playerMicroformatRenderer = (
          playerResponse["microformat"] as Record<string, unknown> | undefined
        )?.["playerMicroformatRenderer"] as Record<string, unknown> | undefined,
        captionTracks = (
          (playerResponse["captions"] as Record<string, unknown> | undefined)?.[
            "playerCaptionsTracklistRenderer"
          ] as Record<string, unknown> | undefined
        )?.["captionTracks"] as { languageCode: string }[] | undefined,
        expectedTranscript = fs.readFileSync(`${fixtureDirectory}${videoId}-transcript.md`, "utf8"),
        srtPath = `${fixtureDirectory}${videoId}-transcript.srt`,
        expectedSrt = fs.existsSync(srtPath) ? fs.readFileSync(srtPath, "utf8") : undefined,
        fixture: FixtureSet = {
          videoId,
          caption,
          innertube,
          description: readFixtureString(videoDetails, "shortDescription"),
          expectedTranscript,
          title: readFixtureString(videoDetails, "title"),
          author: readFixtureString(videoDetails, "author"),
          published: playerMicroformatRenderer
            ? readFixtureString(playerMicroformatRenderer, "publishDate")
            : "",
          image: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
          languageCode: captionTracks?.[0]?.languageCode || "en",
        };
      if (expectedSrt !== undefined) {
        fixture.expectedSrt = expectedSrt;
      }
      return fixture;
    }),
  );
}

function readFixtureString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

const fixtureSets = await discoverFixtures();

type FetchMock = (
  url: string,
  options?: RequestInit,
) => Promise<{ ok: boolean; json?: () => Promise<unknown>; text?: () => Promise<string> }>;

interface TestDeps extends Partial<BackgroundDependencies> {
  calls: {
    titles: string[];
    notifications: { title: string; message: string }[];
    copied: string[];
    progress: string[];
    panel: number;
  };
}

function fixtureFetch(f: FixtureSet): {
  requests: { url: string; options?: RequestInit }[];
  fetchMock: FetchMock;
} {
  const requests: { url: string; options?: RequestInit }[] = [],
    fetchMock: FetchMock = async (url, options) => {
      requests.push(options === undefined ? { url } : { url, options });
      if (url.includes("/youtubei/v1/player"))
        return { ok: true, json: async () => f.innertube["playerResponse"] };
      if (url.includes("/youtubei/v1/next"))
        return { ok: true, json: async () => f.innertube["nextResponse"] };
      if (url.includes("/api/timedtext")) return { ok: true, text: async () => f.caption.xml };
      throw new Error(`Unexpected fixture request: ${url}`);
    };
  return { requests, fetchMock };
}

function dependencies(overrides: Partial<BackgroundDependencies> = {}): TestDeps {
  const calls = {
    titles: [] as string[],
    notifications: [] as { title: string; message: string }[],
    copied: [] as string[],
    progress: [] as string[],
    panel: 0,
  };
  return {
    calls,
    getSettings: async () => ({ language: "" }),
    readPageData: async (): Promise<PageData> => ({
      playerResponse: null,
      initialData: null,
      metadata: { title: "Example video", author: "Example Channel", site: "YouTube" },
      transcript: null,
    }),
    readPanel: async () => {
      calls.panel++;
      return null;
    },
    fetchTranscript: () => Effect.succeed<TranscriptResult | undefined>({
      text: "**0:00** · Hello from API.",
      srt: "1\n00:00:00,000 --> 00:00:05,000\n**0:00** · Hello from API.\n",
      languageCode: "en",
    }),
    copy: async (_tabId: number, text: string): Promise<void> => {
      calls.copied.push(text);
    },
    progress: async (_tabId: number, message: string): Promise<void> => {
      calls.progress.push(message);
    },
    setTitle: async (_tabId: number, title: string): Promise<void> => {
      calls.titles.push(title);
    },
    notify: async (title: string, message: string): Promise<void> => {
      calls.notifications.push({ title, message });
    },
    schedule: () => {},
    log: () => {},
    ...overrides,
  };
}

test("service-worker flow copies API transcript with frontmatter and skips panel fallback", async () => {
  const deps = dependencies(),
    result = await handleActionClick(
      { id: 7, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    );

  assert.equal(result.transcript.languageCode, "en");
  assert.match(deps.calls.copied[0]!, /^---\n/);
  assert.match(deps.calls.copied[0]!, /title: "Example video"/);
  assert.match(deps.calls.copied[0]!, /\*\*0:00\*\* · Hello from API\./);
  assert.equal(deps.calls.panel, 0);
  assert.deepEqual(deps.calls.titles, ["Fetching transcript…", "Transcript copied"]);
});

test("service-worker flow copies SRT subtitles", async () => {
  const deps = dependencies(),
    result = await handleActionClickSrt(
      { id: 14, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    );

  assert.equal(result.transcript.languageCode, "en");
  assert.match(deps.calls.copied[0]!, /^1\n00:00:00,000 --> 00:00:05,000/);
  assert.equal(deps.calls.panel, 0);
  assert.deepEqual(deps.calls.titles, ["Fetching transcript…", "SRT subtitles copied"]);
});

test("service-worker flow falls back to the opened panel when API extraction is empty", async () => {
  const deps = dependencies({
    fetchTranscript: () => Effect.succeed(undefined),
    readPanel: async () => {
      deps.calls.panel++;
      return { segments: [{ start: 0, text: "Panel transcript." }], languageCode: "fr" };
    },
  });
  await handleActionClick(
    { id: 8, url: "https://youtu.be/abc123" } as unknown as chrome.tabs.Tab,
    deps,
  );

  assert.equal(deps.calls.panel, 1);
  assert.match(deps.calls.copied[0]!, /language: "fr"/);
  assert.match(deps.calls.copied[0]!, /\*\*0:00\*\* · Panel transcript\./);
});

test("service-worker flow prefers a rendered DOM transcript when no language is requested", async () => {
  const deps = dependencies({
    readPageData: async () => ({
      playerResponse: null,
      initialData: null,
      metadata: { title: "DOM video", author: "DOM Channel", site: "YouTube" },
      transcript: { segments: [{ start: 5, text: "Already rendered." }], languageCode: "en" },
    }),
    fetchTranscript: () => Effect.fail(new CaptionFetchError("API should not be called")),
  });
  await handleActionClick(
    {
      id: 9,
      url: "https://www.youtube.com/watch?v=abc123" as unknown as string,
    } as unknown as chrome.tabs.Tab,
    deps,
  );
  assert.match(deps.calls.copied[0]!, /\*\*0:05\*\* · Already rendered\./);
});

test("service-worker rejects malformed page data before requesting a transcript", async () => {
  let apiCalled = false;
  const deps = dependencies({
    readPageData: async () => ({ metadata: null, playerResponse: null }),
    fetchTranscript: () => {
      apiCalled = true;
      return Effect.succeed(undefined);
    },
  });

  await assert.rejects(
    handleGetTranscript(
      { id: 20, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    ),
    /Could not read valid transcript data/,
  );
  assert.equal(apiCalled, false);
});

test("service-worker rejects malformed saved language settings", async () => {
  const deps = dependencies({ getSettings: async () => ({ language: 7 }) });

  await assert.rejects(
    handleGetTranscript(
      { id: 21, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    ),
    /Could not read the preferred transcript language setting/,
  );
});

test("service-worker reports malformed transcript panel data at the page boundary", async () => {
  const deps = dependencies({
    fetchTranscript: () => Effect.succeed(undefined),
    readPanel: async () => ({ segments: [{ start: "0", text: "Not a valid segment." }] }),
  });

  await assert.rejects(
    handleGetTranscript(
      { id: 22, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    ),
    /invalid transcript panel data/,
  );
});

function segment(text: string) {
  return {
    querySelector(selector: string) {
      return selector.includes("timestamp")
        ? { textContent: "0:05" }
        : {
            textContent: text,
            trim() {
              return text.trim();
            },
          };
    },
  };
}

test("page collector extracts metadata and rendered transcript data", () => {
  const scripts = [
      {
        textContent:
          'var ytInitialPlayerResponse = {"videoDetails":{"title":"Player title","author":"Channel","thumbnail":{"thumbnails":[{"url":"https://img/1"}]}},"microformat":{"playerMicroformatRenderer":{"publishDate":"2024-01-02"}}};',
      },
      { textContent: "<not json>" },
    ],
    transcriptRoot = {
      querySelectorAll(selector: string) {
        return selector.includes("ytd-transcript") ? [segment("Hello from DOM.")] : [];
      },
    },
    doc = {
      scripts,
      title: "Ignored - YouTube",
      querySelector(selector: string) {
        if (selector.includes("segments-container")) return transcriptRoot;
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === 'script[type="application/ld+json"]') return [];
        return [];
      },
    },
    data = collectPageData(doc as unknown as Document);
  assert.equal(data.metadata.title, "Player title");
  assert.equal(data.metadata.author, "Channel");
  assert.equal(data.metadata.published, "2024-01-02");
  assert.deepEqual(data.transcript!.segments, [{ start: 5, text: "Hello from DOM." }]);
});

test("page collector ignores player-derived metadata when response is stale", () => {
  const scripts = [
      {
        textContent:
          'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"OLD_VID","title":"Old Title","author":"Old Channel","thumbnail":{"thumbnails":[{"url":"https://img/old"}]}},"microformat":{"playerMicroformatRenderer":{"publishDate":"2024-01-01","description":{"simpleText":"Old description"},"ownerChannelName":"Old Channel"}}};',
      },
    ],
    doc = {
      scripts,
      URL: "https://www.youtube.com/watch?v=NEW_VID",
      title: "New Video - YouTube",
      querySelector(selector: string) {
        if (selector.includes('meta[property="og:title"]')) return { content: "New OG Title" };
        if (selector.includes('meta[property="og:description"]'))
          return { content: "New OG Description" };
        if (selector.includes('meta[property="og:image"]')) return { content: "https://img/new" };
        if (selector.includes("#owner-name a")) return { textContent: "  New Channel  " };
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === 'script[type="application/ld+json"]') return [];
        if (selector.includes("ytd-transcript")) return [];
        return [];
      },
    },
    data = collectPageData(doc as unknown as Document);
  assert.equal(data.metadata.title, "New OG Title");
  assert.equal(data.metadata.author, "New Channel");
  assert.equal(data.metadata.description, "New OG Description");
  assert.equal(data.metadata.image, "https://img/new");
  assert.equal(data.metadata.published, "");
  assert.equal(data.transcript, null);
});

test("resolveTranscript skips stale page transcript and falls through to API", async () => {
  let apiCalled = false;
  const result = await Effect.runPromise(resolveTranscript({
    tabUrl: "https://www.youtube.com/watch?v=NEW_VID",
    pageData: {
      playerResponse: { videoDetails: { videoId: "OLD_VID" } },
      initialData: null,
      metadata: { site: "YouTube" },
      transcript: {
        segments: [{ start: 0, text: "Old cached segments." }],
        languageCode: "en",
      },
    },
    fetchTranscript: () => {
      apiCalled = true;
      return Effect.succeed({ text: "**0:00** · Fresh from API.", srt: "", languageCode: "en" });
    },
    readPanel: () => Effect.succeed(null),
  }));

  assert.ok(apiCalled, "should call fetchTranscript instead of using cached page transcript");
  assert.equal(result.transcript.text, "**0:00** · Fresh from API.");
  assert.equal(result.transcript.languageCode, "en");
});

test("player API retries clients and stops at the first caption-bearing response", async () => {
  const requests: RequestInit[] = [],
    responses = [
      { ok: false, json: async () => ({}) },
      {
        ok: true,
        json: async () => ({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{ languageCode: "en", baseUrl: "https://www.youtube.com/captions" }],
            },
          },
        }),
      } as { ok: boolean; json: () => Promise<unknown> },
    ],
    fetchMock = async (_url: string, options?: RequestInit) => {
      requests.push(options!);
      return responses.shift()!;
    },
    result = await Effect.runPromise(fetchPlayerData(
      "abc123",
      "fr",
      fetchMock as typeof globalThis.fetch,
    ));
  assert.equal(getCaptionTracks(result)[0]?.languageCode, "en");
  assert.equal(requests.length, 2);
  assert.equal((requests[0]!.headers as Record<string, string>)["Accept-Language"], "fr");
});

describe("fixtures", () => {
  for (const f of fixtureSets) {
    it(`${f.videoId} produces the captured transcript`, async () => {
      const { requests, fetchMock } = fixtureFetch(f),
        result = await Effect.runPromise(fetchTranscript(
          f.videoId,
          { playerResponse: null },
          undefined,
          [],
          fetchMock as typeof globalThis.fetch,
        )),
        expectedBody = transcriptBody(f.expectedTranscript);

      assert.equal(result!.text, expectedBody);
      assert.equal(result!.languageCode, f.languageCode);
      assert.equal(
        requests.filter((request) => request.url.includes("/youtubei/v1/player")).length,
        1,
      );
      assert.equal(
        requests.filter((request) => request.url.includes("/youtubei/v1/next")).length,
        1,
      );
      assert.equal(requests.filter((request) => request.url.includes("/api/timedtext")).length, 1);
    });

    it(`${f.videoId} produces the captured markdown through the action workflow`, async () => {
      const { fetchMock } = fixtureFetch(f),
        calls: string[] = [],
        result = await handleActionClick(
          {
            id: 10,
            url: `https://www.youtube.com/watch?v=${f.videoId}`,
          } as unknown as chrome.tabs.Tab,
          {
            fetch: fetchMock as typeof globalThis.fetch,
            getSettings: async () => ({ language: "" }),
            readPageData: async (): Promise<PageData> => ({
              playerResponse: null,
              initialData: null,
              metadata: {
                title: f.title,
                author: f.author,
                published: f.published,
                image: f.image,
                site: "YouTube",
                description: f.description,
              },
              transcript: null,
            }),
            readPanel: async () => null,
            copy: async (_tabId: number, text: string): Promise<void> => {
              calls.push(text);
            },
            progress: async () => {},
            setTitle: async () => {},
            notify: async () => {},
            schedule: () => {},
            log: () => {},
          },
        ),
        expectedBody = transcriptBody(f.expectedTranscript),
        actualBody = transcriptBody(calls[0]!);

      assert.equal(result.transcript.text, expectedBody);
      assert.equal(actualBody, expectedBody);
      assert.match(calls[0]!, new RegExp(`language: ${JSON.stringify(f.languageCode)}`));
    });

    it(`${f.videoId} produces the captured SRT through the action workflow`, async () => {
      const { fetchMock } = fixtureFetch(f),
        calls: string[] = [],
        result = await handleActionClickSrt(
          {
            id: 15,
            url: `https://www.youtube.com/watch?v=${f.videoId}`,
          } as unknown as chrome.tabs.Tab,
          {
            fetch: fetchMock as typeof globalThis.fetch,
            getSettings: async () => ({ language: "" }),
            readPageData: async (): Promise<PageData> => ({
              playerResponse: null,
              initialData: null,
              metadata: {
                title: f.title,
                author: f.author,
                published: f.published,
                image: f.image,
                site: "YouTube",
                description: f.description,
              },
              transcript: null,
            }),
            readPanel: async () => null,
            copy: async (_tabId: number, text: string): Promise<void> => {
              calls.push(text);
            },
            progress: async () => {},
            setTitle: async () => {},
            notify: async () => {},
            schedule: () => {},
            log: () => {},
          },
        );

      if (f.expectedSrt) {
        assert.equal(calls[0], f.expectedSrt);
        assert.equal(result.transcript.srt, f.expectedSrt);
      } else {
        assert.match(calls[0]!, /^1\n\d{2}:\d{2}:\d{2},\d{3}/);
        assert.match(result.transcript.srt, /^1\n\d{2}:\d{2}:\d{2},\d{3}/);
      }
    });

    it(`${f.videoId} downloads the captured fixture bundle`, async () => {
      const { fetchMock } = fixtureFetch(f),
        downloads: { filename: string; content: string | Uint8Array; type?: string }[] = [];
      await handleDownloadFixtures!(
        {
          id: 11,
          url: `https://www.youtube.com/watch?v=${f.videoId}`,
        } as unknown as chrome.tabs.Tab,
        {
          fetch: fetchMock as typeof globalThis.fetch,
          getSettings: async () => ({ language: "" }),
          readPageData: async (): Promise<PageData> => ({
            playerResponse: null,
            initialData: null,
            metadata: {
              title: f.title,
              author: f.author,
              published: f.published,
              image: f.image,
              site: "YouTube",
              description: f.description,
            },
            transcript: null,
          }),
          readPanel: async () => null,
          download: async (
            filename: string,
            content: Uint8Array | string,
            type?: string,
          ): Promise<void> => {
            downloads.push(
              type === undefined ? { filename, content } : { filename, content, type },
            );
          },
          progress: async () => {},
          schedule: () => {},
          log: () => {},
        },
      );

      const expectedFilenames = [
        `${f.videoId}-innertube.json.gz`,
        `${f.videoId}-transcript.md`,
        `${f.videoId}-transcript.srt`,
        `${f.videoId}-caption.xml`,
      ];
      assert.deepEqual(
        downloads.map((d) => d.filename),
        expectedFilenames,
      );
      assert.deepEqual(
        (
          JSON.parse(await decompress(downloads[0]!.content as Uint8Array)) as Record<
            string,
            unknown
          >
        )["playerResponse"],
        f.innertube["playerResponse"],
      );
      assert.equal(
        transcriptBody(downloads[1]!.content as string),
        transcriptBody(f.expectedTranscript),
      );
      if (f.expectedSrt) {
        assert.equal(downloads[2]!.content, f.expectedSrt);
      } else {
        assert.match(downloads[2]!.content as string, /^1\n\d{2}:\d{2}:\d{2},\d{3}/);
      }
      assert.equal(downloads[3]!.content, f.caption.xml);
    });
  }
});

test("handleGetTranscript returns the transcript output string", async () => {
  const deps = dependencies(),
    result = await handleGetTranscript(
      { id: 12, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    );

  assert.match(result, /^---\n/);
  assert.match(result, /\*\*0:00\*\* · Hello from API\./);
});

test("handleGetSubtitle returns the SRT output string", async () => {
  const deps = dependencies(),
    result = await handleGetSubtitle(
      { id: 16, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    );

  assert.match(result, /^1\n00:00:00,000 --> 00:00:05,000/);
});

test("handleGetTranscript throws when no transcript is available", async () => {
  const deps = dependencies({
    fetchTranscript: () => Effect.succeed(undefined),
    readPanel: async () => {
      deps.calls.panel++;
      return null;
    },
  });
  await assert.rejects(
    handleGetTranscript(
      { id: 13, url: "https://www.youtube.com/watch?v=abc123" } as unknown as chrome.tabs.Tab,
      deps,
    ),
    /No transcript found/,
  );
});

test("isYouTubeUrl accepts YouTube domains and rejects others", () => {
  assert.ok(isYouTubeUrl("https://www.youtube.com/watch?v=abc123"));
  assert.ok(isYouTubeUrl("https://youtube.com/watch?v=abc123"));
  assert.ok(isYouTubeUrl("https://m.youtube.com/watch?v=abc123"));
  assert.ok(isYouTubeUrl("https://youtu.be/abc123"));
  assert.ok(isYouTubeUrl("https://music.youtube.com/watch?v=abc123"));
  assert.ok(!isYouTubeUrl("https://example.com/watch?v=abc123"));
  assert.ok(!isYouTubeUrl("not a url"));
});

test("getVideoId extracts video IDs from YouTube URLs", () => {
  assert.equal(getVideoId("https://www.youtube.com/watch?v=abc123"), "abc123");
  assert.equal(getVideoId("https://youtu.be/abc123"), "abc123");
  assert.equal(getVideoId("https://www.youtube.com/shorts/abc123"), "abc123");
  assert.equal(getVideoId("https://www.youtube.com/watch?v=abc123&t=30"), "abc123");
  assert.equal(getVideoId("https://youtu.be/abc123?t=30"), "abc123");
});
