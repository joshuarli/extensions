import { isBlobMessage, releaseBlobMessage, type BlobPort } from "./offscreen-protocol.ts";

export function handleBlobUrlMessage(
  data: unknown,
  port: BlobPort,
  createUrl: (blob: Blob) => string,
  revokeUrl: (url: string) => void,
): void {
  if (!isBlobMessage(data)) return;
  const url = createUrl(new Blob([data.bytes], { type: data.type }));
  port.postMessage(url);
  port.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data !== releaseBlobMessage) return;
    revokeUrl(url);
    port.close();
  };
}

if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const port = event.ports[0] as BlobPort | undefined;
    if (!port) return;
    handleBlobUrlMessage(
      event.data,
      port,
      (blob) => URL.createObjectURL(blob),
      (url) => URL.revokeObjectURL(url),
    );
  });
}
