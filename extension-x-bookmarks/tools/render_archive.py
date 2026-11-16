#!/usr/bin/env python3
"""Render an X Archive export into a static HTML page.

Reads an export folder produced by the suite's profile export (posts.json
plus media/) and writes one static, script-free page that mimics X's dark
web timeline: every post with its media, dates, metrics, quoted posts, and
repost/reply context. Media are referenced relatively from media/, so the
page and its files travel as a folder; avatars are rendered as deterministic
initial circles (no network access at view time or generation time).

Usage:
  render_archive.py ARCHIVE_FOLDER [--output PATH] [--text-only]

Defaults: output is ARCHIVE_FOLDER/archive.html. --text-only omits media
entirely.
"""

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CSS = r"""
:root {
  --bg:#000; --panel:#16181c; --border:#2f3336; --text:#e7e9ea; --muted:#71767b;
  --accent:#1d9bf0; --like:#f91880; --rt:#00ba7c;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text);
  font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
.topbar { position:sticky; top:0; z-index:10; backdrop-filter:blur(12px);
  background:rgba(0,0,0,.65); border-bottom:1px solid var(--border); }
.topbar-inner { max-width:598px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:14px; }
.logo { width:42px; height:42px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex:0 0 42px; }
.logo svg { width:22px; height:22px; fill:#e7e9ea; }
.topbar h1 { font-size:17px; margin:0; font-weight:800; letter-spacing:-.2px; }
.topbar p { margin:0; color:var(--muted); font-size:13px; }
.banner { max-width:598px; margin:0 auto; height:84px; border-left:1px solid var(--border); border-right:1px solid var(--border);
  background:linear-gradient(120deg,#1d9bf0 0%,#7856ff 45%,#f91880 100%); opacity:.85; }
.profile { max-width:598px; margin:0 auto; border-left:1px solid var(--border); border-right:1px solid var(--border);
  padding:12px 16px 14px; border-bottom:1px solid var(--border); }
.avatar-lg { width:86px; height:86px; border-radius:50%; border:4px solid #000; margin-top:-54px; display:flex;
  align-items:center; justify-content:center; font-size:30px; font-weight:800; color:#fff; }
.profile .name { font-weight:800; font-size:20px; margin-top:8px; display:flex; align-items:center; gap:6px; }
.profile .handle { color:var(--muted); }
.profile .bio { margin:12px 0; white-space:pre-wrap; }
.profile .meta { display:flex; gap:16px; color:var(--muted); font-size:14px; flex-wrap:wrap; }
.profile .meta b { color:var(--text); }
.feed { max-width:598px; margin:0 auto; border-left:1px solid var(--border); border-right:1px solid var(--border); }
.post { display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); }
.avatar { flex:0 0 40px; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:15px; font-weight:700; color:#fff; user-select:none; }
.post-body { min-width:0; flex:1; }
.rp, .reply-note { color:var(--muted); font-size:13px; display:flex; align-items:center; gap:8px; margin-bottom:3px; }
.rp svg { width:15px; height:15px; fill:var(--rt); }
.rp b, .reply-note b { color:var(--muted); font-weight:500; }
.p-head { display:flex; gap:6px; align-items:baseline; flex-wrap:wrap; min-width:0; }
.p-name { font-weight:800; white-space:nowrap; }
.p-handle,.p-time { color:var(--muted); white-space:nowrap; }
.dot { color:var(--muted); }
.p-text { margin:2px 0 10px; white-space:pre-wrap; word-break:break-word; font-size:15px; }
a { color:var(--accent); text-decoration:none; }
.mention,.hashtag { color:var(--accent); }
.media { display:grid; gap:4px; border-radius:16px; overflow:hidden; border:1px solid var(--border); margin:2px 0 10px; position:relative; }
.media .item { position:relative; overflow:hidden; background:#1c1f23; min-height:120px; }
.media img,.media video { width:100%; height:100%; object-fit:cover; display:block; }
.media.m1 img,.media.m1 video { max-height:510px; }
.media.m1 { grid-template-columns:1fr; }
.media.m2 { grid-template-columns:1fr 1fr; }
.media.m2 .item { max-height:400px; }
.media.m3 { grid-template-columns:1fr 1fr; grid-auto-rows:150px; }
.media.m3 .item:first-child { grid-row:span 2; min-height:0; }
.media.m4 { grid-template-columns:1fr 1fr; grid-auto-rows:155px; }
.media.m2 .item,.media.m3 .item,.media.m4 .item img,.media.m3 .item video,.media.m4 .item video,.media.m4 .item { min-height:0; }
.more { position:absolute; right:8px; bottom:8px; background:rgba(15,20,24,.85); color:#fff; font-size:12px; font-weight:700; padding:3px 10px; border-radius:10px; }
.quoted { border:1px solid var(--border); border-radius:14px; padding:10px 12px; margin:2px 0 10px; }
.quoted .p-head { font-size:14px; }
.quoted .p-text { font-size:14px; margin:1px 0 6px; }
.quoted .media { margin:4px 0 2px; border-radius:12px; }
.quoted .avatar { flex-basis:28px; width:28px; height:28px; font-size:11px; }
.metrics { display:flex; justify-content:space-between; max-width:430px; color:var(--muted); margin-top:4px; }
.metric { display:flex; align-items:center; gap:7px; font-size:13px; }
.metric svg { width:18px; height:18px; fill:var(--muted); }
.metric.views svg { fill:none; stroke:var(--muted); stroke-width:1.6; }
.unavailable { border:1px dashed var(--border); border-radius:14px; padding:18px; color:var(--muted); font-style:italic; margin:6px 0 10px; }
.footer { max-width:598px; margin:0 auto; padding:28px 16px 72px; color:var(--muted); text-align:center;
  border-left:1px solid var(--border); border-right:1px solid var(--border); font-size:13px; }
.verified { width:19px; height:19px; flex:0 0 19px; }
.note { color:var(--muted); font-size:12px; }
"""

X_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 3H21l-6.7 7.66L22 21h-5.4l-4.4-5.15L7.4 21H4.6l7.2-8.24L2 3h5.5l4 4.7L18.244 3Z"/></svg>'
VERIFIED = '<svg class="verified" viewBox="0 0 22 22" aria-hidden="true"><path fill="#1d9bf0" d="M20.4 11c0-.8-.5-1.5-1.1-1.9.2-.9-.2-1.8-.9-2.4-.7-.6-1.7-.7-2.5-.3-.5-.8-1.4-1.3-2.4-1.2-.8.1-1.5.6-2 1.3-.6-.3-1.4-.2-2 .3s-.8 1.6-.4 2.4c-.8.6-1.1 1.7-.7 2.6.5 1 .6 2.1.4 3.2-.2 1 .3 2 1.2 2.5.7.5 1.7.4 2.4-.2.4.8 1.3 1.2 2.2 1.1.8-.2 1.5-.7 2-1.4.8.3 1.8.1 2.4-.7.6-.7.7-1.7.3-2.5.6-.6.9-1.9.9-2.7Z"/><path fill="#000" d="M9.7 15.6l-3.2-3.2 1.4-1.4 1.8 1.8 4.7-4.7 1.4 1.4-6.1 6.1Z"/></svg>'
ICON_REPLY = '<svg viewBox="0 0 24 24"><path d="M1.75 1h21.5c.55 0 1 .45 1 1v13.5c0 .55-.45 1-1 1H14l-5.3 4.4c-.9.74-2.2.04-2.2-1.16V16.5H1.75c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1Z" transform="translate(0 2) scale(.92)"/></svg>'
ICON_RETWEET = '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l2.29 2.1H17a3.5 3.5 0 0 1 3.5 3.5v4h-2v-4A1.5 1.5 0 0 0 17 7.5H6.79l2.3 2.1-1.4 1.5L3.4 5.32a.85.85 0 0 1 0-1.1l4.25-4.1 1.4 1.5-2.4 2.2Zm15 16.24l-2.3-2.1H7A3.5 3.5 0 0 1 3.5 14.5v-4h2v4A1.5 1.5 0 0 0 7 16.5h10.2l-2.3-2.1 1.4-1.5 4.4 4.28c.45.43.45 1.08 0 1.5l-4.25 4.1-1.4-1.5 2.4-2.36Z" transform="translate(0 1)"/></svg>'
ICON_LIKE = '<svg viewBox="0 0 24 24"><path d="M16.7 2c-1.9 0-3.8.9-5 2.3C10.5 2.9 8.6 2 6.7 2 3.5 2 1 4.4 1 7.6c0 3.4 2.5 6.8 8.4 12.6l1.6 1.5c.5.5 1.3.5 1.8 0l1.6-1.5 1.6-1.5 2.8-2.7C22.5 12.8 24 9.4 24 7.6 24 4.4 21.5 2 18.2 2h-1.5Z" transform="scale(.88) translate(1.4 1.2)"/></svg>'
ICON_VIEWS = '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="3.6" height="8" rx="1.2"/><rect x="9.4" y="6" width="3.6" height="14" rx="1.2"/><rect x="15.8" y="9" width="3.6" height="11" rx="1.2"/></svg>'
ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" transform="translate(0 1) scale(.92)"/></svg>'
ICON_REPOST_HEADER = '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l2.29 2.1H17a3.5 3.5 0 0 1 3.5 3.5v4h-2v-4A1.5 1.5 0 0 0 17 7.5H6.79l2.3 2.1-1.4 1.5L3.4 5.32a.85.85 0 0 1 0-1.1l4.25-4.1 1.4 1.5-2.4 2.2Z"/></svg>'
X_LINK = "https://x.com/i/web/status/"


def parse_created_at(raw):
    if not isinstance(raw, str):
        return None
    for fmt in ("%a %b %d %H:%M:%S +0000 %Y", "%a %b %d %H:%M:%S %z %Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_date(dt):
    if not dt:
        return "unknown date"
    return dt.astimezone(timezone.utc).strftime("%b %d, %Y · %-I:%M %p")


def initials_color(seed: str) -> str:
    hue = 0
    for ch in seed:
        hue = (hue * 131 + ord(ch)) % 360
    return f"hsl({hue} 55% 38%)"


def initials(value: str) -> str:
    parts = [p for p in re.split(r"\s+", value or "?") if p]
    if not parts:
        return "?"
    return (parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")).upper()


def avatar_html(author, size=40):
    name = (author or {}).get("name") or (author or {}).get("screen_name") or "?"
    handle = (author or {}).get("screen_name") or "unknown"
    return f'<div class="avatar" style="background:{initials_color(handle)};width:{size}px;height:{size}px;flex-basis:{size}px">{html.escape(initials(name))}</div>'


def esc(value):
    return html.escape(value or "", quote=True)


def linkify(text: str, urls, mentions, hashtags) -> str:
    out = esc(text)
    for raw in sorted({u for u in (urls or []) if isinstance(u, str)}, key=len, reverse=True):
        if not raw:
            continue
        display = raw.removeprefix("https://").removeprefix("http://").rstrip("/")
        replacement = f'<a href="{esc(raw)}" rel="noopener">{esc(display[:60])}</a>'
        out = out.replace(esc(raw), replacement)
    out = re.sub(r"(@\w{1,20})", r'<span class="mention">\1</span>', out)
    out = re.sub(r"(#\w{1,80})", r'<span class="hashtag">\1</span>', out)
    return out


def tweet_media_filename(tweet_id: str, index: int, ext: str, quoted: bool) -> str:
    return f"{tweet_id}{'_quoted' if quoted else ''}_{index}.{ext}"


def ext_from_url(url: str, default: str) -> str:
    match = re.search(r"\.([A-Za-z0-9]{2,5})(?:\?|$)", url or "")
    return (match.group(1).lower() if match else default)


def media_items(post_or_quoted, tweet_id: str, quoted: bool, media_dir: Path, mode: str):
    items = []
    media = (post_or_quoted or {}).get("media") or []
    for index, item in enumerate(media if isinstance(media, list) else []):
        if not isinstance(item, dict):
            continue
        mtype = item.get("type") or "photo"
        url = item.get("url") or ""
        alt = item.get("alt_text") or ""
        if mtype == "photo":
            ext = ext_from_url(url, "jpg")
            kind = "photo"
        elif mtype == "animated_gif":
            ext = "mp4"
            kind = "gif"
        else:
            variants = item.get("variants") or []
            best = max((v for v in variants if isinstance(v, dict) and (v.get("content_type") == "video/mp4")),
                       key=lambda v: v.get("bitrate") or 0, default=None)
            ext = ext_from_url(best.get("url", "") if best else url, "mp4")
            kind = "video"
        filename = tweet_media_filename(tweet_id, index, ext, quoted)
        if mode == "text-only":
            continue
        src = "media/" + filename
        items.append((kind, src, alt))
    return items


def render_media(items, counter):
    if not items:
        return ""
    shown = items[:4]
    extra = len(items) - len(shown)
    cls = f"m{len(shown)}"
    parts = [f'<div class="media {cls}">']
    for kind, src, alt in shown:
        if kind == "photo":
            tag = f'<img loading="lazy" alt="{esc(alt)}" src="{src}">'
        elif kind == "gif":
            tag = f'<video autoplay loop muted playsinline controls preload="metadata" src="{src}"></video>'
        else:
            tag = f'<video controls preload="none" src="{src}"></video>'
        parts.append(f'<div class="item">{tag}</div>')
    if extra > 0:
        parts[-1] = parts[-1].replace("</div>", f'<span class="more">+{extra}</span></div>')
    parts.append("</div>")
    return "".join(parts)


def metric(icon, number):
    try:
        value = int(number)
    except (TypeError, ValueError):
        value = 0
    return f'<span class="metric">{icon}<span>{value:,}</span></span>'


def render_quoted(quoted, tweet_id, mode, media_dir):
    if not isinstance(quoted, dict):
        return ""
    if quoted.get("status") == "unavailable":
        return '<div class="quoted"><div class="unavailable">This quote post is unavailable.</div></div>'
    author = quoted.get("author") or {}
    text = quoted.get("full_text") or ""
    urls = (quoted.get("entities") or {}).get("urls") or []
    metrics = quoted.get("metrics") or {}
    qmedia = media_items(quoted, tweet_id, True, media_dir, mode)
    return (
        '<div class="quoted">'
        f'<div class="post" style="padding:0;border:0">{avatar_html(author, 28)}'
        '<div class="post-body">'
        f'<div class="p-head"><span class="p-name">{esc(author.get("name") or author.get("screen_name") or "?")}</span>'
        f'<span class="p-handle">@{esc(author.get("screen_name") or "unknown")}</span>'
        f'<span class="dot">·</span><span class="p-time">{esc(fmt_date(parse_created_at(quoted.get("created_at"))))}</span></div>'
        f'<div class="p-text quoted-text">{linkify(text, [u.get("expanded_url") or u.get("url") for u in urls if isinstance(u, dict)], None, None)}</div>'
        f'{render_media(qmedia, None)}'
        f'<div class="metrics" style="max-width:280px">{metric(ICON_REPLY, metrics.get("replies"))}{metric(ICON_RETWEET, metrics.get("retweets"))}{metric(ICON_LIKE, metrics.get("likes"))}</div>'
        "</div></div></div>"
    )


def render_post(post, mode, media_dir):
    tweet_id = str(post.get("tweet_id") or "?")
    created = parse_created_at(post.get("created_at"))
    author = post.get("author") or {}
    name = author.get("name") or author.get("screen_name") or "?"
    handle = author.get("screen_name") or "unknown"
    verified = VERIFIED if author.get("verified") else ""
    status = post.get("status") or "available"
    unavailable = status == "unavailable"

    head_bits = []
    if post.get("repost_of"):
        head_bits.append(f'<div class="rp">{ICON_REPOST_HEADER}<span><b>{esc(name)}</b> reposted</span></div>')
    if post.get("in_reply_to_tweet_id"):
        head_bits.append(f'<div class="reply-note">Replying to <a href="{X_LINK}{esc(str(post["in_reply_to_tweet_id"]))}" rel="noopener">post {esc(str(post["in_reply_to_tweet_id"]))}</a></div>')

    entities = post.get("entities") or {}
    url_values = [u.get("expanded_url") or u.get("url") for u in (entities.get("urls") or []) if isinstance(u, dict)]

    media = media_items(post, tweet_id, False, media_dir, mode)
    quoted = post.get("quoted_tweet") if isinstance(post.get("quoted_tweet"), dict) else None
    quoted_html = render_quoted(quoted, tweet_id, mode, media_dir) if quoted else ""

    metrics = post.get("metrics") or {}
    metrics_html = (
        f'<div class="metrics">{metric(ICON_REPLY, metrics.get("replies"))}'
        f'{metric(ICON_RETWEET, metrics.get("retweets"))}'
        f'{metric(ICON_LIKE, metrics.get("likes"))}'
        f'{metric(ICON_BOOKMARK, metrics.get("bookmarks"))}'
        f'<span class="metric views">{ICON_VIEWS}<span>{int(metrics.get("views") or 0):,}</span></span></div>'
    )

    if unavailable:
        reason = post.get("unavailable_reason") or "This post is unavailable."
        body = f'<div class="unavailable">{esc(reason)}</div>'
    else:
        body = (
            f'<div class="p-text">{linkify(post.get("full_text") or "", url_values, entities.get("mentions"), entities.get("hashtags"))}</div>'
            f'{render_media(media, None)}'
            f'{quoted_html}'
            f'{metrics_html}'
        )

    return (
        f'<article class="post" id="post-{esc(tweet_id)}">{avatar_html(author)}'
        '<div class="post-body">'
        + "".join(head_bits)
        + f'<div class="p-head"><span class="p-name">{esc(name)}</span>{verified}'
          f'<span class="p-handle">@{esc(handle)}<span class="dot"> · </span><a href="{X_LINK}{esc(tweet_id)}" rel="noopener"><span class="p-time">{esc(fmt_date(created))}</span></a></span></div>'
        + body
        + "</div></article>"
    )


def main():
    parser = argparse.ArgumentParser(description="Render an X Archive export folder into one static HTML page.")
    parser.add_argument("archive", type=Path, help="Path to the export folder (containing posts.json and media/)")
    parser.add_argument("--output", type=Path, default=None, help="Output HTML path (default: ARCHIVE/archive.html)")
    parser.add_argument("--text-only", action="store_true", help="Omit media entirely")
    args = parser.parse_args()

    folder = args.archive
    posts_path = folder / "posts.json"
    alt_path = posts_path if posts_path.is_file() else next((folder / name for name in ("likes.json", "bookmarks.json") if (folder / name).is_file()), None)
    if alt_path is None:
        parser.error(f"no posts.json, likes.json or bookmarks.json in {folder}")

    mode = "text-only" if args.text_only else "media"
    media_dir = folder / "media"
    output = args.output or (folder / "archive.html")

    with alt_path.open() as handle:
        data = json.load(handle)
    if "posts" in data:
        archive_kind = "posts"
        posts = data.get("posts") or []
        profile = data.get("profile") or {}
        if not any(profile.get(key) for key in ("screen_name", "name")):
            first_author = next((p.get("author") for p in posts if isinstance(p.get("author"), dict)), {})
            profile = {**profile, **{k: first_author.get(k) for k in ("user_id", "screen_name", "name", "profile_image_url", "verified", "followers_count")}}
    elif "likes" in data:
        archive_kind = "likes"
        posts = data.get("likes") or []
        profile = {}
    elif "bookmarks" in data:
        archive_kind = "bookmarks"
        posts = data.get("bookmarks") or []
        profile = {}
    else:
        parser.error(f"{alt_path} carries no posts, likes or bookmarks array")
    meta = data.get("export_metadata") or {}

    def sort_key(post):
        parsed = parse_created_at(post.get("created_at"))
        return (parsed is not None, parsed or datetime(1970, 1, 1, tzinfo=timezone.utc))

    posts = sorted(posts, key=sort_key, reverse=True)

    kind_label = {"posts": "archive", "likes": "likes archive", "bookmarks": "bookmarks archive"}[archive_kind]
    visible_name = (profile.get("name") or profile.get("screen_name") or "X " + kind_label).strip()
    handle = profile.get("screen_name") or ""
    stats = (meta.get("stats") or {})
    total_posts = stats.get("total_posts") or len(posts)
    exported_at = meta.get("exported_at") or "unknown date"
    available = stats.get("available_posts", sum(1 for p in posts if p.get("status") != "unavailable"))
    unavailable = stats.get("unavailable_posts", len(posts) - available)

    parts = [f"<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{esc(visible_name)} — archive</title>\n<style>{CSS}</style>\n</head>\n<body>\n"]
    parts.append(
        f'<header class="topbar"><div class="topbar-inner"><div class="logo" style="background:#16181c">{X_LOGO}</div>'
        f'<div><h1>{esc(visible_name)}</h1><p>{esc(kind_label)} · {total_posts} posts · exported {esc(exported_at)}</p></div></div></header>\n'
    )
    if archive_kind == "posts":
        parts.append(
            f'<div class="banner"></div>\n'
            f'<section class="profile"><div class="avatar-lg" style="background:{initials_color(handle or visible_name)}">{esc(initials(visible_name))}</div>'
            f'<div class="name">{esc(visible_name)} {VERIFIED if profile.get("verified") else ""}</div>'
            f'<div class="handle">@{esc(handle)}</div>'
            + (f'<div class="bio">{esc(profile.get("description"))}</div>' if profile.get("description") else "")
            + (f'<div class="meta"><span><b>{int(profile.get("followers_count") or 0):,}</b> followers</span>' if int(profile.get("followers_count") or 0) > 0 else '<div class="meta">')
            + f'<span><b>{total_posts}</b> posts archived</span><span class="note">cumulative archive</span></div></section>\n'
        )
    parts.append(f'<main class="feed">\n')

    for post in posts:
        parts.append(render_post(post, mode, media_dir))

    parts.append(
        f'</main><footer class="footer">End of the archive · {total_posts} posts ({available} available, {unavailable} unavailable)<br>'
        'Generated by the local X Archive exporter — static page, no scripts.</footer>\n</body>\n</html>\n'
    )

    written = 0
    encoder_note = 0
    with output.open("w", encoding="utf-8") as out:
        for part in parts:
            out.write(part)
            written += len(part)

    size_mb = written / (1024 * 1024)
    print(f"render_archive: wrote {output} ({size_mb:,.1f} MB, {len(posts)} posts, mode={mode})")


if __name__ == "__main__":
    main()
