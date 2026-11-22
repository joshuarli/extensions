import { homedir } from "node:os";
import { join } from "node:path";

export function downloadsRoot(): string {
  const configured = process.env["CHATGPT_ARCHIVE_DOWNLOADS"];
  if (configured) return configured;
  const base = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
  return join(base, "chatgpt-archive", "downloads");
}
