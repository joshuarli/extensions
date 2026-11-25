export const CHATGPT_OPERATIONS = ["session", "conversations.list", "conversation.get", "files.download"] as const;

export type ChatgptOperation = (typeof CHATGPT_OPERATIONS)[number];

export const SESSION_PATH = "/api/auth/session";

export const RECIPE_FILES: Record<ChatgptOperation, string> = {
  "session": "chatgpt-client-core/recipes/session.json",
  "conversations.list": "chatgpt-client-core/recipes/conversations-list.json",
  "conversation.get": "chatgpt-client-core/recipes/conversation-get.json",
  "files.download": "chatgpt-client-core/recipes/files-download.json",
};
