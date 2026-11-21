export const chatgptExtensionName = "ChatGPT Organizer";

export const chatgptManifest = {
  manifest_version: 3,
  name: chatgptExtensionName,
  short_name: "Triage",
  version: "0.2.0",
  description: "Review, mark and safely bulk-organize your ChatGPT conversations with a resumable queue and a backup before deletion.",
  minimum_chrome_version: "120",
  icons: {
    "16": "icons/16.png",
    "32": "icons/32.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  action: {
    default_title: "Open ChatGPT Organizer",
    default_icon: {
      "16": "icons/16.png",
      "32": "icons/32.png",
      "48": "icons/48.png",
    },
  },
  background: {
    service_worker: "service-worker.js",
    type: "module",
  },
  permissions: ["storage"],
  host_permissions: ["https://chatgpt.com/*"],
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*"],
      js: ["inject/content.js"],
      run_at: "document_idle",
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
} satisfies chrome.runtime.ManifestV3;
