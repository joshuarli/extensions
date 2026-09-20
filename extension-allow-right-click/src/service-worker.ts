const protectedScripts = [
    "user-select/isolated.js",
    "styles.js",
    "mouse.js",
    "listen/isolated.js",
  ] as const,
  unprotectedScripts = ["user-select/main.js", "listen/main.js"] as const,
  executeCore = async (tabId: number): Promise<void> => {
    await chrome.scripting.executeScript({
      target: { allFrames: true, tabId },
      injectImmediately: true,
      files: ["/data/inject/core.js"],
    });
  };

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    void executeCore(tab.id).catch((error: unknown) => {
      console.warn("Allow Right-Click could not run on this tab", error);
    });
  }
});

chrome.runtime.onMessage.addListener((request: ArcRuntimeRequest, sender) => {
  const tabId = sender.tab?.id,
    frameId = sender.frameId;
  if (tabId === undefined || frameId === undefined) {
    return;
  }

  if (request.method === "activate") {
    if (frameId === 0) {
      void chrome.action.setIcon({
        tabId,
        path: {
          "16": "/data/icons/active/16.png",
          "32": "/data/icons/active/32.png",
          "48": "/data/icons/active/48.png",
        },
      });
    }
    for (const file of protectedScripts) {
      void chrome.scripting.executeScript({
        target: { frameIds: [frameId], tabId },
        injectImmediately: true,
        files: [`/data/inject/${file}`],
      });
    }
    for (const file of unprotectedScripts) {
      void chrome.scripting.executeScript({
        target: { frameIds: [frameId], tabId },
        injectImmediately: true,
        files: [`/data/inject/${file}`],
        world: "MAIN",
      });
    }
  } else if (request.method === "deactivate" && frameId === 0) {
    void chrome.action.setIcon({
      tabId,
      path: {
        "16": "/data/icons/16.png",
        "32": "/data/icons/32.png",
        "48": "/data/icons/48.png",
      },
    });
  }
});
