export const chatgptManifest = {
  permissions: ["storage"],
  host_permissions: ["https://chatgpt.com/*"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
} as const;
