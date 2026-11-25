import { mediaPaths } from "./media.ts";
import type { CollectionState, Post } from "./types.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export interface CollectionPage {
  readonly state: CollectionState;
  readonly posts: readonly Post[];
}

export interface SiteFiles {
  readonly files: Readonly<Record<string, string>>;
  readonly count: number;
}

function mediaElement(post: Post, path: string): string {
  const name = escapeHtml(post.shortcode);
  const source = escapeHtml("images/" + path);
  if (post.postType === "video" || path.endsWith(".mp4")) {
    return '<video src="' + source + '" controls preload="metadata" aria-label="' + name + '"></video>';
  }
  return '<img src="' + source + '" alt="' + name + '" loading="lazy">';
}

function postHtml(post: Post): string {
  const images = mediaPaths(post).map((path) => "    " + mediaElement(post, path)).join("\n");
  const caption = post.caption === null ? "" : "<p>" + escapeHtml(post.caption) + "</p>";
  const author = post.username === null ? "" : "<small>@" + escapeHtml(post.username) + "</small>";
  return '<article id="' + escapeHtml(post.shortcode) + '">\n'
    + "  <h3>" + escapeHtml(post.shortcode) + "</h3>\n"
    + "  " + author + "\n" + images + "\n  " + caption + "\n</article>";
}

export function renderCollection(page: CollectionPage): SiteFiles {
  const key = escapeHtml(page.state.key);
  const posts = [...page.posts].sort((a, b) => b.shortcode.localeCompare(a.shortcode));
  const cards = posts.map(postHtml).join("\n");
  const body = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<title>" + key + "</title><link rel=\"stylesheet\" href=\"site.css\"></head>\n<body>\n"
    + "<h1>" + key + "</h1>\n<p><a href=\"index.html\">All collections</a></p>\n"
    + cards + "\n</body>\n</html>\n";
  const data = posts.map((post) => ({
    shortcode: post.shortcode,
    username: post.username,
    postType: post.postType,
    caption: post.caption,
    media: mediaPaths(post),
  }));
  return {
    files: {
      [page.state.key + ".html"]: body,
      ["data/" + page.state.key + ".json"]: JSON.stringify(data, null, 2) + "\n",
    },
    count: posts.length,
  };
}

export function renderIndex(collections: readonly CollectionState[]): string {
  const links = collections.map((state) =>
    '<li><a href="' + escapeHtml(state.key) + '.html">' + escapeHtml(state.key) + "</a></li>").join("\n");
  return "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<title>Instagram archive</title><link rel=\"stylesheet\" href=\"site.css\"></head>\n<body>\n"
    + "<h1>Instagram archive</h1>\n<ul>\n" + links + "\n</ul>\n</body>\n</html>\n";
}

export const SITE_CSS = "body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}"
  + "article{border-top:1px solid #ccc;padding:1rem 0}img,video{max-width:100%;height:auto}"
  + "small{color:#666}";
