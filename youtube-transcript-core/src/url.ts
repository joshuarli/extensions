export function isYouTubeUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

export function getVideoId(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "youtu.be") {
    return parsed.pathname.slice(1).split("/")[0] || "";
  }
  if (parsed.pathname.includes("/shorts/")) {
    return parsed.pathname.split("/shorts/")[1]?.split("/")[0] || "";
  }
  return parsed.searchParams.get("v") || "";
}
