const scriptRoot = "/inject/allow-right-click",
  protectedScripts = [
    "user-select/isolated.js",
    "styles.js",
    "mouse.js",
    "listen/isolated.js",
  ] as const,
  unprotectedScripts = ["user-select/main.js", "listen/main.js"] as const;

export function isArcRuntimeRequest(message: unknown): message is ArcRuntimeRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "method" in message &&
    (message.method === "activate" || message.method === "deactivate")
  );
}

export async function executeCore(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { allFrames: true, tabId },
    injectImmediately: true,
    files: [`${scriptRoot}/core.js`],
  });
}

export async function readArcStatus(tabId: number): Promise<ArcStatus> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => (globalThis as { pointers?: { status?: unknown } }).pointers?.status,
  });
  return result?.result === "ready" || result?.result === "removed" ? result.result : "";
}

export interface AllowRightClickBackground {
  isMessage: typeof isArcRuntimeRequest;
  handleMessage: (request: ArcRuntimeRequest, sender: chrome.runtime.MessageSender) => void;
  toggle: typeof executeCore;
  readStatus: typeof readArcStatus;
}

export function createAllowRightClickBackground(options: {
  setActive: (tabId: number, active: boolean) => void;
}): AllowRightClickBackground {
  return {
    isMessage: isArcRuntimeRequest,
    handleMessage(request, sender) {
      const tabId = sender.tab?.id,
        frameId = sender.frameId;
      if (tabId === undefined || frameId === undefined) {
        return;
      }

      if (request.method === "activate") {
        for (const file of protectedScripts) {
          void chrome.scripting
            .executeScript({
              target: { frameIds: [frameId], tabId },
              injectImmediately: true,
              files: [`${scriptRoot}/${file}`],
            })
            .catch(() => undefined);
        }
        for (const file of unprotectedScripts) {
          void chrome.scripting
            .executeScript({
              target: { frameIds: [frameId], tabId },
              injectImmediately: true,
              files: [`${scriptRoot}/${file}`],
              world: "MAIN",
            })
            .catch(() => undefined);
        }
        if (frameId === 0) {
          options.setActive(tabId, true);
        }
      } else if (frameId === 0) {
        options.setActive(tabId, false);
      }
    },
    toggle: executeCore,
    readStatus: readArcStatus,
  };
}
