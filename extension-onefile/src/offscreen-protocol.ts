export const blobMessageKind = "onefile/blob-url";
export const releaseBlobMessage = "onefile/release-blob";

export interface BlobMessage {
  readonly kind: typeof blobMessageKind;
  readonly bytes: ArrayBuffer;
  readonly type: string;
}

export interface BlobPort {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close(): void;
}

export function isBlobMessage(value: unknown): value is BlobMessage {
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
