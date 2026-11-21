import { isPingRequest } from "./messages.ts";

const dashboardUrl = chrome.runtime.getURL("dashboard.html");

async function openDashboard(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === dashboardUrl);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: dashboardUrl, active: true });
}

chrome.action.onClicked.addListener(() => {
  void openDashboard();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void openDashboard();
});

chrome.runtime.onMessage.addListener((message) => {
  return isPingRequest(message);
});
