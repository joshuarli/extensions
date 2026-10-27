import { ResourceFetchError } from "./errors.ts";
import { capturePolicy } from "./policy.ts";

export interface FetchedResource {
  data: Uint8Array;
  mime: string;
}

const mimePattern = /[^/]+\/[^;]+/u;

function toFetchError(url: string, error: unknown): ResourceFetchError {
  if (error instanceof ResourceFetchError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ResourceFetchError(url, "timeout", `Timed out fetching ${url}.`);
  }
  if (error instanceof Error) {
    return new ResourceFetchError(url, "network", `Could not fetch ${url}: ${error.message}`);
  }
  return new ResourceFetchError(url, "network", `Could not fetch ${url}.`);
}

function sniffMime(url: string, header: string | null): string {
  const match = header?.match(mimePattern);
  if (match) return match[0].trim().toLowerCase();
  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    case "ico":
      return "image/x-icon";
    case "css":
      return "text/css";
    case "woff2":
      return "font/woff2";
    case "woff":
      return "font/woff";
    case "ttf":
      return "font/ttf";
    case "otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const boundFetch: typeof fetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);

export async function fetchResourceBytes(
  url: string,
  fetcher: typeof fetch = boundFetch,
): Promise<FetchedResource> {
  let lastError: ResourceFetchError | null = null;
  for (let attempt = 0; attempt <= capturePolicy.fetchRetryAttempts; attempt++) {
    if (attempt > 0) await sleep(capturePolicy.fetchRetryBackoffMs * attempt);
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(capturePolicy.fetchTimeoutMs) });
      if (!response.ok) {
        lastError = new ResourceFetchError(url, "bad-status", `HTTP ${response.status} for ${url}.`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > capturePolicy.maxResourceBytes) {
        throw new ResourceFetchError(
          url,
          "too-large",
          `${url} is ${buffer.byteLength} bytes, above the resource cap.`,
        );
      }
      return { data: new Uint8Array(buffer), mime: sniffMime(url, response.headers.get("content-type")) };
    } catch (error) {
      lastError = toFetchError(url, error);
      if (lastError.reason === "too-large") throw lastError;
    }
  }
  throw lastError ?? new ResourceFetchError(url, "network", `Could not fetch ${url}.`);
}
