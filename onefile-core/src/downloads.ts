import { Effect } from "effect";
import { DownloadFailedError } from "./errors.ts";

export interface DownloadTarget {
  filename: string;
  bytes: Uint8Array;
}

export interface DownloadTransport {
  downloadBlob: (blob: Blob, filename: string) => Promise<number>;
}

export function downloadArchive(
  transport: DownloadTransport,
  target: DownloadTarget,
): Effect.Effect<number, DownloadFailedError> {
  return Effect.tryPromise({
    try: async () => {
      try {
        return await transport.downloadBlob(
          new Blob([target.bytes.slice().buffer], { type: "application/octet-stream" }),
          target.filename,
        );
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
