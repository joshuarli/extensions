import { Effect } from "effect";
import { DownloadFailedError } from "./errors.ts";
import { capturePolicy } from "./policy.ts";

export interface DownloadTarget {
  filename: string;
  bytes: Uint8Array;
}

export interface DownloadTransport {
  downloadDataUrl: (url: string, filename: string) => Promise<number>;
}

export function encodeBase64Chunked(bytes: Uint8Array): string {
  const step = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function downloadArchive(
  transport: DownloadTransport,
  target: DownloadTarget,
): Effect.Effect<number, DownloadFailedError> {
  if (target.bytes.length > capturePolicy.maxDirectDownloadBytes) {
    return Effect.fail(
      new DownloadFailedError(
        "too-large",
        `${target.filename} is ${target.bytes.length} bytes, above the direct-download cap.`,
      ),
    );
  }
  return Effect.tryPromise({
    try: async () => {
      const url = `data:application/octet-stream;base64,${encodeBase64Chunked(target.bytes)}`;
      try {
        return await transport.downloadDataUrl(url, target.filename);
      } catch (error) {
        throw new DownloadFailedError("rejected", `The browser refused ${target.filename}.`, error);
      }
    },
    catch: (error) =>
      error instanceof DownloadFailedError
        ? error
        : new DownloadFailedError("rejected", `The browser refused ${target.filename}.`, error),
  });
}
