import { blobMessageKind, releaseBlobMessage } from "./offscreen-protocol.ts";

const offscreenPath = "features/onefile/offscreen.html";

let offscreenQueue: Promise<void> = Promise.resolve();

interface OffscreenWindowClient {
  url: string;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

interface OffscreenClients {
  matchAll: (options: {
    includeUncontrolled: boolean;
    type: "window";
  }) => Promise<OffscreenWindowClient[]>;
}

function ensureOffscreenDocument(): Promise<void> {
  const next = offscreenQueue.then(async () => {
    const offscreenUrl = chrome.runtime.getURL(offscreenPath);
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: offscreenPath,
        reasons: ["BLOBS"],
        justification: "Create a blob URL for a large archive download.",
      });
    }
  });
  offscreenQueue = next.catch(() => undefined);
  return next;
}

export interface ArchiveBlobUrl {
  readonly url: string;
  release(): void;
}

export async function createArchiveBlobUrl(bytes: ArrayBuffer, type: string): Promise<ArchiveBlobUrl> {
  await ensureOffscreenDocument();
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);
  const clients = await (globalThis as unknown as { clients: OffscreenClients }).clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  const client = clients.find((candidate) => candidate.url === offscreenUrl);
  if (!client) throw new Error("Onefile offscreen document is unavailable.");

  const channel = new MessageChannel();
  try {
    const url = await new Promise<string>((resolve, reject) => {
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") {
          resolve(event.data);
        } else {
          reject(new Error("Onefile offscreen document returned an invalid URL."));
        }
      };
      channel.port1.onmessageerror = () =>
        reject(new Error("Onefile offscreen message failed."));
      client.postMessage({ kind: blobMessageKind, bytes, type }, [bytes, channel.port2]);
    });
    return {
      url,
      release() {
        channel.port1.postMessage(releaseBlobMessage);
        channel.port1.close();
      },
    };
  } catch (error) {
    channel.port1.close();
    throw error;
  }
}
