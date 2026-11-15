export const xBookmarksManifest = {
  permissions: [
    "cookies",
    "storage",
    "unlimitedStorage",
    "webRequest",
    "declarativeNetRequestWithHostAccess",
    "downloads",
    "contextMenus",
  ],
  host_permissions: ["https://x.com/*"],
} as const;
