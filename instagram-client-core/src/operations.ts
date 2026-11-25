export const INSTAGRAM_OPERATIONS = [
  "session",
  "profile.posts",
  "profile.info",
  "media.info",
  "media.download",
  "following",
  "saved",
] as const;

export type InstagramOperation = (typeof INSTAGRAM_OPERATIONS)[number];

export const GRAPHQL_PATH = "/api/graphql";
export const PROFILE_QUERY_NAME = "PolarisProfilePostsQuery";

export function profileInfoPath(username: string): string {
  return "/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username);
}

export function followingPath(userId: string, cursor: string | null): string {
  const params = new URLSearchParams({ count: "20" });
  if (cursor !== null) params.set("max_id", cursor);
  return "/api/v1/friendships/" + encodeURIComponent(userId) + "/following/?" + params.toString();
}

export function mediaInfoPath(mediaId: string): string {
  return "/api/v1/media/" + encodeURIComponent(mediaId) + "/info/";
}

export const SAVED_PATH = "/saved/all-posts/";

export const RECIPE_FILES: Record<InstagramOperation, string> = {
  "session": "instagram-client-core/recipes/session.json",
  "profile.posts": "instagram-client-core/recipes/profile-posts.json",
  "profile.info": "instagram-client-core/recipes/profile-info.json",
  "media.info": "instagram-client-core/recipes/media-info.json",
  "media.download": "instagram-client-core/recipes/media-download.json",
  "following": "instagram-client-core/recipes/following.json",
  "saved": "instagram-client-core/recipes/saved.json",
};
