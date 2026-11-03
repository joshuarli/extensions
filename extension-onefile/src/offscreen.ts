const blobMessageKind = "onefile/blob-url";

interface BlobMessage {
  kind: typeof blobMessageKind;
  bytes: ArrayBuffer;
  type: string;
}

function isBlobMessage(value: unknown): value is BlobMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === blobMessageKind &&
    "bytes" in value &&
    value.bytes instanceof ArrayBuffer &&
    "type" in value &&
    typeof value.type === "string"
  );
}

navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data,
    port = event.ports[0];
  if (!port || !isBlobMessage(data)) return;
  const url = URL.createObjectURL(new Blob([data.bytes], { type: data.type }));
  port.postMessage(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
