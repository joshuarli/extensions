export const xBookmarksManifest = {
  permissions: [
    "cookies",
    "storage",
    "unlimitedStorage",
    "webRequest",
    "declarativeNetRequestWithHostAccess",
    "downloads",
    "contextMenus",
    "notifications",
  ],
  host_permissions: ["https://x.com/*"],
} as const;
