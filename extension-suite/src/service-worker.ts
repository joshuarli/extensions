import { Schema } from "effect";
import { createAllowRightClickBackground } from "../../extension-allow-right-click/src/background.ts";
import { createOnefileBackground } from "../../extension-onefile/src/background.ts";
import {
  clearYouTubeTranscriptCaches,
  handleExternalMessage,
  handleInternalMessage,
} from "../../extension-youtube-transcript/src/background.ts";
import { isYouTubeTranscriptMessage } from "../../extension-youtube-transcript/src/message-contract.ts";
import {
  handleXBookmarksRequest,
  installXBookmarksHeaderRule,
  xBookmarksRequestFilter,
} from "../../extension-x-bookmarks/src/background.ts";
import { createActionStatus } from "./action-status.ts";
import {
  isSuiteRequest,
  SuiteResponseSchema,
  type SuiteRequest,
  type SuiteResponse,
} from "./message-contract.ts";

const defaultTitle = "Browser Extensions";

const actionStatus = createActionStatus(defaultTitle, {
  setTitle: (tabId, title) => chrome.action.setTitle({ tabId, title }),
  setBadgeText: (tabId, text) => chrome.action.setBadgeText({ tabId, text }),
  setBadgeBackgroundColor: (tabId, color) =>
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
});

const allowRightClick = createAllowRightClickBackground({
  setActive: (tabId, active) => {
    if (active) {
      actionStatus.set("allow-right-click", tabId, { badge: "ON", badgeColor: "#188038" });
    } else {
      actionStatus.clear("allow-right-click", tabId);
    }
  },
});

const onefile = createOnefileBackground({
  setActionState: ({ tabId, title, badge }) => {
    actionStatus.set("onefile", tabId, {
      title,
      badge,
      badgeColor: badge === "!" ? "#c5221f" : "#1a73e8",
    });
  },
  clearActionState: (tabId) => actionStatus.clear("onefile", tabId),
});

async function setYouTubeTitle(tabId: number, title: string): Promise<void> {
  actionStatus.set("youtube-transcript", tabId, { title });
}

async function clearYouTubeTitle(tabId: number): Promise<void> {
  actionStatus.clear("youtube-transcript", tabId);
}

async function handleSuiteRequest(request: SuiteRequest): Promise<SuiteResponse> {
  switch (request.kind) {
    case "allow-right-click/toggle": {
      await allowRightClick.toggle(request.tabId);
      return { ok: true };
    }
    case "allow-right-click/status": {
      try {
        const status = await allowRightClick.readStatus(request.tabId);
        return { status: status === "ready" ? "on" : status === "removed" ? "off" : "" };
      } catch {
        return { status: "" };
      }
    }
    case "onefile/save": {
      const tab = await chrome.tabs.get(request.tabId);
      void onefile.save(tab);
      return { ok: true };
    }
    case "x-bookmarks/open-exporter": {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("features/x-bookmarks/options.html"),
      });
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isSuiteRequest(message)) {
    void handleSuiteRequest(message).then(
      (response) => sendResponse(Schema.decodeUnknownSync(SuiteResponseSchema)(response)),
      (error: unknown) =>
        sendResponse(
          Schema.decodeUnknownSync(SuiteResponseSchema)({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
    );
    return true;
  }

  if (allowRightClick.isMessage(message)) {
    allowRightClick.handleMessage(message, sender);
    sendResponse({ ok: true });
    return false;
  }

  if (isYouTubeTranscriptMessage(message)) {
    return handleInternalMessage(message, sender, sendResponse, {
      setTitle: setYouTubeTitle,
      clearTitle: clearYouTubeTitle,
    });
  }

  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) =>
  handleExternalMessage(message, sender, sendResponse),
);

chrome.tabs.onRemoved.addListener((tabId) => {
  clearYouTubeTranscriptCaches();
  actionStatus.forgetTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    clearYouTubeTranscriptCaches();
  }
  if (changeInfo.status === "loading") {
    actionStatus.clearTab(tabId);
  }
});

chrome.webRequest.onSendHeaders.addListener(
  handleXBookmarksRequest,
  xBookmarksRequestFilter,
  ["requestHeaders", "extraHeaders"],
);

chrome.runtime.onInstalled.addListener(installXBookmarksHeaderRule);
chrome.runtime.onStartup.addListener(installXBookmarksHeaderRule);
