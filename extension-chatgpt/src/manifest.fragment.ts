export const chatgptManifest = {
  permissions: ["storage"],
  host_permissions: ["https://chatgpt.com/*"],
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*"],
      js: ["inject/chatgpt/content.js"],
      run_at: "document_idle",
    },
  ],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
} as const;
