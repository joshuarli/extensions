export interface CaptionTrack {
  languageCode: string;
  kind?: string;
  baseUrl?: string;
}

export interface TranscriptSegment {
  start: number;
  text: string;
  speakerChange?: boolean;
  speaker?: number;
}

export interface Chapter {
  title: string;
  start: number;
}

export interface TranscriptPanelData {
  segments: TranscriptSegment[];
  languageCode?: string;
}

export interface TranscriptResult {
  text: string;
  srt: string;
  languageCode?: string;
}

export interface PageMetadata {
  title?: string;
  author?: string;
  published?: string;
  source?: string;
  image?: string;
  site?: string;
  description?: string;
  language?: string;
}

export interface PageData {
  playerResponse: unknown;
  initialData: unknown;
  metadata: PageMetadata;
  transcript: TranscriptPanelData | null;
}

export interface ResolveTranscriptInput {
  tabUrl: string;
  pageData: PageData;
  preferredLanguage?: string;
  fetchTranscript: (chapters: Chapter[]) => Promise<TranscriptResult | undefined>;
  readPanel: () => Promise<TranscriptPanelData | null>;
}

export interface ResolveTranscriptOutput {
  metadata: PageMetadata;
  transcript: TranscriptResult;
}

export interface BackgroundDependencies {
  fetch: typeof globalThis.fetch;
  getSettings: () => Promise<{ language: string }>;
  readPageData: (tabId: number) => Promise<PageData>;
  readPanel: (tabId: number) => Promise<TranscriptPanelData | null>;
  fetchTranscript: (
    videoId: string,
    pageData: PageData,
    preferredLanguage: string | undefined,
    chapters: Chapter[],
    fetchImpl: typeof globalThis.fetch,
  ) => Promise<TranscriptResult | undefined>;
  copy: (tabId: number, text: string) => Promise<void>;
  progress: (tabId: number, message: string, done?: boolean) => Promise<void>;
  setTitle: (tabId: number, title: string) => Promise<void>;
  notify: (title: string, message: string) => Promise<void>;
  download?: (filename: string, content: Uint8Array | string, type?: string) => Promise<void>;
  schedule: (fn: () => void, ms: number) => void;
  log: (...args: unknown[]) => void;
}

export type FetchMock = (url: string, options?: RequestInit) => Promise<Response>;
