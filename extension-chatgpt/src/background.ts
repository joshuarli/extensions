import { isPingRequest } from "./messages.ts";

export const chatgptDashboardPath = "features/chatgpt/dashboard.html";

export async function openChatgptDashboard(): Promise<void> {
  const dashboardUrl = chrome.runtime.getURL(chatgptDashboardPath);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url === dashboardUrl);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: dashboardUrl, active: true });
}

export function isChatgptMessage(message: unknown): boolean {
  return isPingRequest(message);
}
