export const youtubeTranscriptManifest = {
  permissions: [
    "activeTab",
    "scripting",
    "clipboardWrite",
    "downloads",
    "notifications",
    "declarativeNetRequestWithHostAccess",
    "storage",
  ],
  host_permissions: [
    "https://www.youtube.com/*",
    "https://m.youtube.com/*",
    "https://youtube.com/*",
    "https://youtu.be/*",
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'",
  },
  externally_connectable: {
    matches: ["https://www.youtube.com/*", "https://m.youtube.com/*", "https://youtube.com/*"],
  },
  declarative_net_request: {
    rule_resources: [
      {
        id: "youtube-headers",
        enabled: true,
        path: "rules/youtube-headers.json",
      },
    ],
  },
} as const;
