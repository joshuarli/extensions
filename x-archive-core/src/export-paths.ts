export function exportFolderName(screenName: string | null | undefined, userId: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const handle = screenName?.replace(/[^A-Za-z0-9._-]+/gu, "").replace(/^\.+/u, "").slice(0, 60) ?? "";
  return handle.length > 0 ? handle + "-" + date : "x-profile-" + userId + "-" + date;
}

export function bookmarksFolderName(now: Date = new Date()): string {
  return "bookmarks-" + now.toISOString().slice(0, 10);
}

export function likesFolderName(now: Date = new Date()): string {
  return "likes-" + now.toISOString().slice(0, 10);
}
