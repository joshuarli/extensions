// The parsed-page fields mirror the narrow JSON returned by defuddle-wasm. Keep
// This boundary separate from the Rust DefuddleResult type.
export interface LoupeParsedPage {
  content: string;
  content_markdown: string | null;
  title: string;
  author: string;
  description: string;
  published: string;
  site: string;
  domain: string;
  extractor_type: string | null;
}

export interface ListExtractorsResponse {
  extractorNames: string[];
}

// Service-worker request fields use explicit page/content names so callers can
// Distinguish raw page snapshots from extracted reader output.
export interface ParsePageRequest {
  action: "parsePage";
  pageHtml: string;
  pageUrl: string;
  extractorName: string;
}

export interface ListExtractorsRequest {
  action: "listExtractors";
}

export interface DownloadReaderFixturesRequest {
  action: "downloadFixtures";
  rawPageHtml: string;
  extractedContentHtml: string;
  extractedContentMarkdown: string | null;
  readerUiHtml: string;
  downloadSlug: string;
  extractorName: string;
}

export interface DownloadReaderFixturesResponse {
  ok: boolean;
  error?: string;
}

export interface OpenObsidianUrlRequest {
  action: "openObsidian";
  obsidianUrl: string;
}

export interface OpenObsidianUrlResponse {
  ok: boolean;
  error?: string;
}

export interface ToggleReaderMessage {
  action: "toggle";
}

export type ServiceWorkerRequest =
  | ParsePageRequest
  | ListExtractorsRequest
  | DownloadReaderFixturesRequest
  | OpenObsidianUrlRequest;

export interface ParsePageResponse {
  ok: boolean;
  parsedPage?: LoupeParsedPage;
  error?: string;
}
