#!/usr/bin/env python3
"""Render an X Archive export into a static HTML page.

Reads an export folder produced by the suite's profile export (posts.json
plus media/) and writes one static page that mimics X's dark web timeline:
every post with its media, dates, metrics, quoted posts, and repost/reply
context. Media are referenced relatively from media/, so the page and its
files travel as a folder. Post media, avatars, and the profile banner are
all lazy loaded. Clicking a thumbnail opens a lightbox scoped to that
post's media; arrow keys and buttons cycle through the gallery, Escape
closes. The page carries one small inline script for the lightbox (no
external requests); everything else works with scripts disabled.

At render time the tool fetches the profile photo and the profile banner
from x.com so the page can show them; both are cached into media/ (as
media/profile.<ext> and media/cover.jpg) so re-renders and offline viewing
reuse the cached files. If the fetch fails the page falls back to initial
circles and a gradient banner. --no-fetch disables the network access
entirely and uses only the cached assets.

Usage:
  render_archive.py ARCHIVE_FOLDER [--output PATH] [--text-only] [--no-fetch]

Defaults: output is ARCHIVE_FOLDER/archive.html. --text-only omits media
entirely.
"""

import argparse
import collections
import html
import json
import re
import sys
import urllib.error
import urllib.request
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
.banner { max-width:598px; margin:0 auto; height:150px; border-left:1px solid var(--border); border-right:1px solid var(--border);
  background:linear-gradient(120deg,#1d9bf0 0%,#7856ff 45%,#f91880 100%); overflow:hidden; }
.banner img { width:100%; height:100%; object-fit:cover; display:block; }
.profile { max-width:598px; margin:0 auto; border-left:1px solid var(--border); border-right:1px solid var(--border);
  padding:12px 16px 14px; border-bottom:1px solid var(--border); }
.avatar-lg { width:86px; height:86px; border-radius:50%; border:4px solid #000; margin-top:-54px; display:flex;
  align-items:center; justify-content:center; font-size:30px; font-weight:800; color:#fff; }
.avatar-lg img { width:100%; height:100%; border-radius:50%; object-fit:cover; display:block; }
.profile .name { font-weight:800; font-size:20px; margin-top:8px; }
.profile .handle { color:var(--muted); }
.profile .bio { margin:12px 0; white-space:pre-wrap; }
.profile .meta { display:flex; gap:16px; color:var(--muted); font-size:14px; flex-wrap:wrap; }
.profile .meta b { color:var(--text); }
.feed { max-width:598px; margin:0 auto; border-left:1px solid var(--border); border-right:1px solid var(--border); }
.post { display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); }
.avatar { flex:0 0 40px; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:15px; font-weight:700; color:#fff; user-select:none; overflow:hidden; }
.avatar img { width:100%; height:100%; object-fit:cover; display:block; border-radius:50%; }
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
.media .item { position:relative; display:block; overflow:hidden; background:#1c1f23; min-height:120px; cursor:zoom-in; text-decoration:none; }
.media .item:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.media img,.media video { width:100%; height:100%; object-fit:cover; display:block; }
.media.m1 img,.media.m1 video { max-height:510px; }
.media.m1 { grid-template-columns:1fr; }
.media.m2 { grid-template-columns:1fr 1fr; }
.media.m2 .item { max-height:400px; }
.media.m3 { grid-template-columns:1fr 1fr; grid-auto-rows:150px; }
.media.m3 .item:first-child { grid-row:span 2; min-height:0; }
.media.m4 { grid-template-columns:1fr 1fr; grid-auto-rows:155px; }
.media.m2 .item,.media.m3 .item,.media.m4 .item img,.media.m3 .item video,.media.m4 .item video,.media.m4 .item { min-height:0; }
.more { position:absolute; right:8px; bottom:8px; background:rgba(15,20,24,.85); color:#fff; font-size:12px; font-weight:700; padding:3px 10px; border-radius:10px; pointer-events:none; }
.play { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:44px; height:44px; border-radius:50%;
  background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; pointer-events:none; }
.play svg { width:18px; height:18px; fill:#fff; margin-left:2px; }
.badge-gif { position:absolute; left:8px; bottom:8px; background:rgba(0,0,0,.7); color:#fff; font-size:11px; font-weight:700;
  padding:2px 8px; border-radius:8px; pointer-events:none; letter-spacing:.4px; }
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
.note { color:var(--muted); font-size:12px; }
.context-note { color:var(--muted); font-size:11px; border:1px solid var(--border); border-radius:8px; padding:0 6px; margin-left:2px; }
.context-archive[hidden] { display:none; }
.lightbox { position:fixed; inset:0; z-index:100; background:rgba(0,0,0,.92); display:flex; align-items:center; justify-content:center; }
.lightbox[hidden] { display:none; }
.lb-stage { display:flex; align-items:center; justify-content:center; max-width:92vw; max-height:88vh; }
.lb-stage img,.lb-stage video { max-width:92vw; max-height:88vh; border-radius:8px; background:#000; }
.lb-btn { position:absolute; z-index:1; width:42px; height:42px; border:0; border-radius:50%; background:rgba(22,24,28,.75);
  color:var(--text); display:flex; align-items:center; justify-content:center; cursor:pointer; }
.lb-btn:hover { background:rgba(47,51,54,.9); }
.lb-btn svg { width:22px; height:22px; fill:var(--text); }
.lb-close { top:16px; right:16px; }
.lb-prev { left:14px; top:50%; transform:translateY(-50%); }
.lb-next { right:14px; top:50%; transform:translateY(-50%); }
.lb-count { position:absolute; bottom:16px; left:50%; transform:translateX(-50%); background:rgba(22,24,28,.8);
  color:var(--text); font-size:13px; padding:4px 14px; border-radius:13px; }
@media (max-width:700px) { .lb-prev { left:6px; } .lb-next { right:6px; } }
.thread-btn { display:inline-flex; align-items:center; gap:5px; background:none; border:1px solid var(--border); border-radius:16px;
  color:var(--muted); font-size:12px; font-weight:600; padding:2px 10px; cursor:pointer; margin-top:6px; }
.thread-btn:hover { color:var(--accent); border-color:var(--accent); }
.thread-btn svg { width:14px; height:14px; fill:var(--muted); }
.thread-btn:hover svg { fill:var(--accent); }
.thread-overlay { position:fixed; inset:0; z-index:90; background:rgba(0,0,0,.92); display:flex; justify-content:center; }
.thread-overlay[hidden] { display:none; }
.thread-panel { width:100%; max-width:620px; display:flex; flex-direction:column; background:var(--bg);
  border-left:1px solid var(--border); border-right:1px solid var(--border); }
.thread-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border); }
.thread-head b { font-size:16px; }
.thread-head .note { color:var(--muted); font-size:12px; }
.thread-head .note { color:var(--muted); font-size:12px; }
.thread-close { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border:0; border-radius:50%;
  background:rgba(22,24,28,.75); cursor:pointer; }
.thread-close:hover { background:rgba(47,51,54,.9); }
.thread-close svg { width:18px; height:18px; fill:var(--text); }
.thread-scroll { overflow-y:auto; flex:1; padding:0 0 40px; }
.thread-current { outline:2px solid var(--accent); outline-offset:-2px; background:#10171d; }
"""

X_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 3H21l-6.7 7.66L22 21h-5.4l-4.4-5.15L7.4 21H4.6l7.2-8.24L2 3h5.5l4 4.7L18.244 3Z"/></svg>'
ICON_REPLY = '<svg viewBox="0 0 24 24"><path d="M1.75 1h21.5c.55 0 1 .45 1 1v13.5c0 .55-.45 1-1 1H14l-5.3 4.4c-.9.74-2.2.04-2.2-1.16V16.5H1.75c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1Z" transform="translate(0 2) scale(.92)"/></svg>'
ICON_RETWEET = '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l2.29 2.1H17a3.5 3.5 0 0 1 3.5 3.5v4h-2v-4A1.5 1.5 0 0 0 17 7.5H6.79l2.3 2.1-1.4 1.5L3.4 5.32a.85.85 0 0 1 0-1.1l4.25-4.1 1.4 1.5-2.4 2.2Zm15 16.24l-2.3-2.1H7A3.5 3.5 0 0 1 3.5 14.5v-4h2v4A1.5 1.5 0 0 0 7 16.5h10.2l-2.3-2.1 1.4-1.5 4.4 4.28c.45.43.45 1.08 0 1.5l-4.25 4.1-1.4-1.5 2.4-2.36Z" transform="translate(0 1)"/></svg>'
ICON_LIKE = '<svg viewBox="0 0 24 24"><path d="M16.7 2c-1.9 0-3.8.9-5 2.3C10.5 2.9 8.6 2 6.7 2 3.5 2 1 4.4 1 7.6c0 3.4 2.5 6.8 8.4 12.6l1.6 1.5c.5.5 1.3.5 1.8 0l1.6-1.5 1.6-1.5 2.8-2.7C22.5 12.8 24 9.4 24 7.6 24 4.4 21.5 2 18.2 2h-1.5Z" transform="scale(.88) translate(1.4 1.2)"/></svg>'
ICON_VIEWS = '<svg viewBox="0 0 24 24"><rect x="3" y="12" width="3.6" height="8" rx="1.2"/><rect x="9.4" y="6" width="3.6" height="14" rx="1.2"/><rect x="15.8" y="9" width="3.6" height="11" rx="1.2"/></svg>'
ICON_BOOKMARK = '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" transform="translate(0 1) scale(.92)"/></svg>'
ICON_REPOST_HEADER = '<svg viewBox="0 0 24 24"><path d="M4.5 3.88l2.29 2.1H17a3.5 3.5 0 0 1 3.5 3.5v4h-2v-4A1.5 1.5 0 0 0 17 7.5H6.79l2.3 2.1-1.4 1.5L3.4 5.32a.85.85 0 0 1 0-1.1l4.25-4.1 1.4 1.5-2.4 2.2Z"/></svg>'
ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z" transform="translate(1 0) scale(.92)"/></svg>'
ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 5.4 8.8 12l6.6 6.6-1.4 1.4L6 12l8-8z" transform="translate(1 0)"/></svg>'
ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 5.4 15.2 12l-6.6 6.6 1.4 1.4L18 12l-8-8z" transform="translate(-1 0)"/></svg>'
ICON_THREAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8.4L4 19.8V5Z"/></svg>'
X_LINK = "https://x.com/i/web/status/"

THREAD_HTML = (
    '<div class="thread-overlay" id="thread-overlay" hidden role="dialog" aria-modal="true" aria-label="Thread">\n'
    '  <div class="thread-panel">\n'
    '    <div class="thread-head">\n'
    '      <div><b>Thread</b><div class="note" id="thread-sub"></div></div>\n'
    f'      <button class="thread-close" aria-label="Close">{ICON_CLOSE}</button>\n'
    '    </div>\n'
    '    <div class="thread-scroll"><div id="thread-archived"></div></div>\n'
    '  </div>\n'
    '</div>\n'
    '<script>\n'
    '(function () {\n'
    '  var overlay = document.getElementById("thread-overlay");\n'
    '  if (!overlay) return;\n'
    '  var scroll = overlay.querySelector(".thread-scroll");\n'
    '  var archivedPane = overlay.querySelector("#thread-archived");\n'
    '  var sub = overlay.querySelector("#thread-sub");\n'
    '  var lastFocus = null;\n'
    '  function archivedPostsOf(cid) {\n'
    '    var nodes = document.querySelectorAll(\'article.post[data-conversation="\' + cid + \'"]\');\n'
    '    var arr = Array.prototype.slice.call(nodes);\n'
    '    arr.sort(function (a, b) {\n'
    '      return (a.getAttribute("data-sort-index") || "").localeCompare(b.getAttribute("data-sort-index") || "");\n'
    '    });\n'
    '    return arr;\n'
    '  }\n'
    '  function open(cid, fromEl) {\n'
    '    var arr = archivedPostsOf(cid);\n'
    '    if (!arr.length) return;\n'
    '    archivedPane.innerHTML = "";\n'
    '    arr.forEach(function (node) {\n'
    '      var clone = node.cloneNode(true);\n'
    '      clone.removeAttribute("id");\n'
    '      archivedPane.appendChild(clone);\n'
    '    });\n'
    '    var current = fromEl && fromEl.closest ? fromEl.closest(".post") : null;\n'
    '    if (current) {\n'
    '      var wanted = current.getAttribute("data-tweet");\n'
    '      var clones = archivedPane.querySelectorAll("article.post");\n'
    '      for (var i = 0; i < clones.length; i++) {\n'
    '        if (clones[i].getAttribute("data-tweet") === wanted) clones[i].classList.add("thread-current");\n'
    '      }\n'
    '    }\n'
    '    sub.textContent = arr.length + " post" + (arr.length === 1 ? "" : "s") + " in this conversation · fully offline";\n'
    '    lastFocus = document.activeElement;\n'
    '    overlay.hidden = false;\n'
    '    document.body.style.overflow = "hidden";\n'
    '    scroll.scrollTop = 0;\n'
    '    var marked = archivedPane.querySelector(".thread-current");\n'
    '    if (marked) marked.scrollIntoView({ block: "start" });\n'
    '    overlay.querySelector(".thread-close").focus();\n'
    '  }\n'
    '  function close() {\n'
    '    if (overlay.hidden) return;\n'
    '    overlay.hidden = true;\n'
    '    document.body.style.overflow = "";\n'
    '    archivedPane.innerHTML = "";\n'
    '    if (lastFocus && lastFocus.focus) lastFocus.focus();\n'
    '  }\n'
    '  document.addEventListener("click", function (event) {\n'
    '    var target = event.target;\n'
    '    var btn = target && target.closest ? target.closest(".thread-btn") : null;\n'
    '    if (btn) {\n'
    '      event.preventDefault();\n'
    '      open(btn.getAttribute("data-thread"), btn);\n'
    '      return;\n'
    '    }\n'
    '    if (target === overlay) close();\n'
    '  });\n'
    '  overlay.querySelector(".thread-close").addEventListener("click", close);\n'
    '  document.addEventListener("keydown", function (event) {\n'
    '    if (event.key === "Escape" && !overlay.hidden) close();\n'
    '  });\n'
    '})();\n'
    '</script>\n'
)

LIGHTBOX_HTML = (
    '<div class="lightbox" id="lightbox" hidden role="dialog" aria-modal="true" aria-label="Media viewer">\n'
    f'  <button class="lb-btn lb-close" aria-label="Close">{ICON_CLOSE}</button>\n'
    f'  <button class="lb-btn lb-prev" aria-label="Previous media">{ICON_CHEVRON_LEFT}</button>\n'
    '  <div class="lb-stage"></div>\n'
    f'  <button class="lb-btn lb-next" aria-label="Next media">{ICON_CHEVRON_RIGHT}</button>\n'
    '  <div class="lb-count"></div>\n'
    '</div>\n'
    '<script>\n'
    '(function () {\n'
    '  var lb = document.getElementById("lightbox");\n'
    '  if (!lb) return;\n'
    '  var stage = lb.querySelector(".lb-stage");\n'
    '  var count = lb.querySelector(".lb-count");\n'
    '  var prev = lb.querySelector(".lb-prev");\n'
    '  var next = lb.querySelector(".lb-next");\n'
    '  var current = [];\n'
    '  var index = 0;\n'
    '  var lastFocus = null;\n'
    '  function itemsOf(gallery) {\n'
    '    return Array.prototype.slice.call(gallery.querySelectorAll("a.item[data-type]"));\n'
    '  }\n'
    '  function render() {\n'
    '    var item = current[index];\n'
    '    var type = item.getAttribute("data-type");\n'
    '    var src = item.getAttribute("href");\n'
    '    var alt = item.getAttribute("data-alt") || "";\n'
    '    stage.innerHTML = "";\n'
    '    var el;\n'
    '    if (type === "photo") {\n'
    '      el = document.createElement("img");\n'
    '      el.src = src;\n'
    '      el.alt = alt;\n'
    '    } else {\n'
    '      el = document.createElement("video");\n'
    '      el.src = src;\n'
    '      el.controls = true;\n'
    '      el.autoplay = true;\n'
    '      el.playsInline = true;\n'
    '      el.setAttribute("playsinline", "");\n'
    '      if (type === "gif") { el.loop = true; el.muted = true; }\n'
    '    }\n'
    '    stage.appendChild(el);\n'
    '    var multiple = current.length > 1;\n'
    '    prev.style.visibility = next.style.visibility = multiple ? "visible" : "hidden";\n'
    '    count.style.display = multiple ? "" : "none";\n'
    '    count.textContent = (index + 1) + " / " + current.length;\n'
    '  }\n'
    '  function open(gallery, start) {\n'
    '    current = itemsOf(gallery);\n'
    '    if (!current.length) return;\n'
    '    index = start;\n'
    '    lastFocus = document.activeElement;\n'
    '    lb.hidden = false;\n'
    '    document.body.style.overflow = "hidden";\n'
    '    render();\n'
    '    lb.querySelector(".lb-close").focus();\n'
    '  }\n'
    '  function close() {\n'
    '    if (lb.hidden) return;\n'
    '    lb.hidden = true;\n'
    '    document.body.style.overflow = "";\n'
    '    stage.innerHTML = "";\n'
    '    if (lastFocus && lastFocus.focus) lastFocus.focus();\n'
    '  }\n'
    '  function step(delta) {\n'
    '    if (current.length < 2) return;\n'
    '    index = (index + delta + current.length) % current.length;\n'
    '    render();\n'
    '  }\n'
    '  document.addEventListener("click", function (event) {\n'
    '    var target = event.target;\n'
    '    var link = target && target.closest ? target.closest("a.item[data-type]") : null;\n'
    '    if (link) {\n'
    '      var gallery = link.closest("[data-gallery]");\n'
    '      if (gallery) {\n'
    '        event.preventDefault();\n'
    '        open(gallery, itemsOf(gallery).indexOf(link));\n'
    '      }\n'
    '      return;\n'
    '    }\n'
    '    if (target === lb) close();\n'
    '  });\n'
    '  lb.querySelector(".lb-close").addEventListener("click", close);\n'
    '  prev.addEventListener("click", function () { step(-1); });\n'
    '  next.addEventListener("click", function () { step(1); });\n'
    '  document.addEventListener("keydown", function (event) {\n'
    '    if (lb.hidden) return;\n'
    '    if (event.key === "Escape") close();\n'
    '    else if (event.key === "ArrowLeft") step(-1);\n'
    '    else if (event.key === "ArrowRight") step(1);\n'
    '  });\n'
    '})();\n'
    '</script>\n'
)


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


def avatar_html(author, size=40, assets=None):
    name = (author or {}).get("name") or (author or {}).get("screen_name") or "?"
    handle = (author or {}).get("screen_name") or "unknown"
    style = f"width:{size}px;height:{size}px;flex-basis:{size}px"
    image = (assets or {}).get("image")
    profile_handle = (assets or {}).get("profile_handle") or ""
    if image and handle.lower() == profile_handle.lower():
        return (f'<div class="avatar" style="{style}">'
                f'<img loading="lazy" decoding="async" src="{esc(image)}" alt="{esc(name)}"></div>')
    return f'<div class="avatar" style="background:{initials_color(handle)};{style}">{html.escape(initials(name))}</div>'


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


def media_items(post_or_quoted, tweet_id: str, quoted: bool, mode: str):
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
        if mode != "media":
            continue
        src = "media/" + filename
        items.append((kind, src, alt))
    return items


def render_media(items):
    if not items:
        return ""
    shown = items[:4]
    extra = len(items) - len(shown)
    cls = f"m{len(shown)}"
    parts = [f'<div class="media {cls}" data-gallery>']
    for kind, src, alt in shown:
        label = esc(alt) or {"photo": "Open photo", "gif": "Play GIF", "video": "Play video"}[kind]
        parts.append(f'<a class="item" href="{esc(src)}" data-type="{kind}" data-alt="{esc(alt)}" aria-label="{label}">')
        if kind == "photo":
            parts.append(f'<img loading="lazy" decoding="async" alt="{esc(alt)}" src="{esc(src)}">')
        elif kind == "gif":
            parts.append(f'<video preload="none" muted loop playsinline src="{esc(src)}"></video><span class="badge-gif">GIF</span>')
        else:
            parts.append(f'<video preload="none" src="{esc(src)}"></video><span class="play">{ICON_PLAY}</span>')
        parts.append('</a>')
    if extra > 0:
        parts[-1] = parts[-1] + f'<span class="more">+{extra}</span>'
    parts.append("</div>")
    return "".join(parts)


def metric(icon, number):
    try:
        value = int(number)
    except (TypeError, ValueError):
        value = 0
    return f'<span class="metric">{icon}<span>{value:,}</span></span>'


def render_quoted(quoted, tweet_id, mode, assets):
    if not isinstance(quoted, dict):
        return ""
    if quoted.get("status") == "unavailable":
        return '<div class="quoted"><div class="unavailable">This quote post is unavailable.</div></div>'
    author = quoted.get("author") or {}
    text = quoted.get("full_text") or ""
    urls = (quoted.get("entities") or {}).get("urls") or []
    metrics = quoted.get("metrics") or {}
    qmedia = media_items(quoted, tweet_id, True, mode)
    return (
        '<div class="quoted">'
        f'<div class="post" style="padding:0;border:0">{avatar_html(author, 28, assets)}'
        '<div class="post-body">'
        f'<div class="p-head"><span class="p-name">{esc(author.get("name") or author.get("screen_name") or "?")}</span>'
        f'<span class="p-handle">@{esc(author.get("screen_name") or "unknown")}</span>'
        f'<span class="dot">·</span><span class="p-time">{esc(fmt_date(parse_created_at(quoted.get("created_at"))))}</span></div>'
        f'<div class="p-text quoted-text">{linkify(text, [u.get("expanded_url") or u.get("url") for u in urls if isinstance(u, dict)], None, None)}</div>'
        f'{render_media(qmedia)}'
        f'<div class="metrics" style="max-width:280px">{metric(ICON_REPLY, metrics.get("replies"))}{metric(ICON_RETWEET, metrics.get("retweets"))}{metric(ICON_LIKE, metrics.get("likes"))}</div>'
        "</div></div></div>"
    )


def render_post(post, mode, assets, conv_counts):
    tweet_id = str(post.get("tweet_id") or "?")
    created = parse_created_at(post.get("created_at"))
    author = post.get("author") or {}
    name = author.get("name") or author.get("screen_name") or "?"
    handle = author.get("screen_name") or "unknown"
    status = post.get("status") or "available"
    unavailable = status == "unavailable"
    conversation_id = str(post.get("conversation_id") or "")
    sort_index = str(post.get("sort_index") or "")
    parent_id = post.get("in_reply_to_tweet_id")
    parent_attr = str(parent_id) if parent_id else ""
    conv_size = conv_counts.get(conversation_id, 1) if conversation_id else 1
    show_thread = bool(conversation_id) and (bool(parent_id) or conv_size > 1)
    data_attrs = (
        f' data-tweet="{esc(tweet_id)}" data-conversation="{esc(conversation_id)}"'
        f' data-sort-index="{esc(sort_index)}" data-parent="{esc(parent_attr)}"')

    head_bits = []
    if post.get("repost_of"):
        head_bits.append(f'<div class="rp">{ICON_REPOST_HEADER}<span><b>{esc(name)}</b> reposted</span></div>')
    if post.get("in_reply_to_tweet_id"):
        head_bits.append(f'<div class="reply-note">Replying to <a href="{X_LINK}{esc(str(post["in_reply_to_tweet_id"]))}" rel="noopener">post {esc(str(post["in_reply_to_tweet_id"]))}</a></div>')

    entities = post.get("entities") or {}
    url_values = [u.get("expanded_url") or u.get("url") for u in (entities.get("urls") or []) if isinstance(u, dict)]

    is_context = mode == "context"
    media = media_items(post, tweet_id, False, mode)
    quoted = post.get("quoted_tweet") if isinstance(post.get("quoted_tweet"), dict) else None
    quoted_html = render_quoted(quoted, tweet_id, "text-only" if is_context else mode, assets) if quoted else ""

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
            f'{render_media(media)}'
            f'{quoted_html}'
            f'{metrics_html}'
        )
    if show_thread and not is_context:
        body += f'<button class="thread-btn" data-thread="{esc(conversation_id)}">{ICON_THREAD}Thread</button>'

    article_class = "post context-post" if is_context else "post"
    return (
        f'<article class="{article_class}" id="post-{esc(tweet_id)}"{data_attrs}>{avatar_html(author, 40, assets)}'
        '<div class="post-body">'
        + "".join(head_bits)
        + f'<div class="p-head"><span class="p-name">{esc(name)}</span>{" <span class=\"context-note\">thread context</span>" if is_context else ""}'
          f'<span class="p-handle">@{esc(handle)}<span class="dot"> · </span><a href="{X_LINK}{esc(tweet_id)}" rel="noopener"><span class="p-time">{esc(fmt_date(created))}</span></a></span></div>'
        + body
        + "</div></article>"
    )


BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}


def http_get(url: str, timeout: float = 30.0) -> bytes:
    request = urllib.request.Request(url, headers={
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,image/*,*/*;q=0.8",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def cached_asset(media_dir: Path, base: str):
    if not media_dir.is_dir():
        return None
    for path in sorted(media_dir.iterdir()):
        if path.is_file() and path.stem == base and path.suffix.lstrip(".").lower() in IMAGE_EXTENSIONS:
            return path
    return None


def asset_from_bytes(media_dir: Path, base: str, url: str, payload: bytes, default_ext: str):
    ext = ext_from_url(url, default_ext)
    if ext not in IMAGE_EXTENSIONS:
        ext = default_ext
    media_dir.mkdir(parents=True, exist_ok=True)
    target = media_dir / f"{base}.{ext}"
    temporary = target.with_suffix(target.suffix + ".part")
    temporary.write_bytes(payload)
    temporary.replace(target)
    return target


def fetch_profile_assets(profile, media_dir: Path, allow_fetch: bool):
    assets = {"image": None, "banner": None, "profile_handle": (profile or {}).get("screen_name") or ""}
    if not profile:
        return assets
    handle = assets["profile_handle"]

    image_file = cached_asset(media_dir, "profile")
    image_url = profile.get("profile_image_url") or ""
    if image_file:
        assets["image"] = "media/" + image_file.name
    elif allow_fetch and image_url:
        large = re.sub(r"_normal(\.[A-Za-z0-9]+)$", r"_400x400\1", image_url)
        try:
            assets["image"] = "media/" + asset_from_bytes(media_dir, "profile", large, http_get(large), "jpg").name
        except Exception as error:
            print(f"render_archive: could not fetch profile photo: {error}", file=sys.stderr)

    banner_file = cached_asset(media_dir, "cover")
    if banner_file:
        assets["banner"] = "media/" + banner_file.name
    elif allow_fetch and handle:
        try:
            page = http_get(f"https://x.com/{handle}").decode("utf-8", errors="replace")
            match = re.search(r"https://pbs\.twimg\.com/profile_banners/\d+/\d+/1500x500", page)
            if match:
                banner_url = match.group(0)
                assets["banner"] = "media/" + asset_from_bytes(media_dir, "cover", banner_url, http_get(banner_url), "jpg").name
            else:
                print(f"render_archive: no banner found on the x.com profile page for @{handle}", file=sys.stderr)
        except Exception as error:
            print(f"render_archive: could not fetch cover photo: {error}", file=sys.stderr)
    return assets


def main():
    parser = argparse.ArgumentParser(description="Render an X Archive export folder into one static HTML page.")
    parser.add_argument("archive", type=Path, help="Path to the export folder (containing posts.json and media/)")
    parser.add_argument("--output", type=Path, default=None, help="Output HTML path (default: ARCHIVE/archive.html)")
    parser.add_argument("--text-only", action="store_true", help="Omit media entirely")
    parser.add_argument("--no-fetch", action="store_true", help="Do not hit the network; use cached profile/cover photos")
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
            authority = collections.Counter(
                (post.get("author") or {}).get("screen_name")
                for post in posts if isinstance(post, dict) and isinstance(post.get("author"), dict)
            )
            authority.pop(None, None)
            donor = None
            if authority:
                top = authority.most_common(1)[0][0]
                donor = next((post.get("author") for post in posts
                              if (post.get("author") or {}).get("screen_name") == top), None)
            if donor:
                profile = {**profile,
                           **{k: donor.get(k) for k in ("user_id", "screen_name", "name", "profile_image_url", "verified", "followers_count")
                              if not profile.get(k)}}
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
    context_posts = data.get("context_posts") if archive_kind == "posts" else None
    context_posts = context_posts if isinstance(context_posts, list) else []
    context_ids = sum(1 for post in context_posts if isinstance(post, dict) and post.get("tweet_id"))

    def sort_key(post):
        parsed = parse_created_at(post.get("created_at"))
        return (parsed is not None, parsed or datetime(1970, 1, 1, tzinfo=timezone.utc))

    posts = sorted(posts, key=sort_key, reverse=True)

    allow_fetch = not args.no_fetch
    assets = fetch_profile_assets(profile if profile else None, media_dir, allow_fetch) if archive_kind == "posts" \
        else {"image": None, "banner": None, "profile_handle": ""}

    kind_label = {"posts": "archive", "likes": "likes archive", "bookmarks": "bookmarks archive"}[archive_kind]
    visible_name = (profile.get("name") or profile.get("screen_name") or "X " + kind_label).strip()
    handle = profile.get("screen_name") or ""
    stats = (meta.get("stats") or {})
    total_posts = stats.get("total_posts") or len(posts)
    exported_at = meta.get("exported_at") or "unknown date"
    available = stats.get("available_posts", sum(1 for p in posts if p.get("status") != "unavailable"))
    unavailable = stats.get("unavailable_posts", len(posts) - available)

    profile_image = assets.get("image")
    header_avatar = (
        f'<img loading="lazy" decoding="async" src="{esc(profile_image)}" alt="{esc(visible_name)}">'
        if profile_image else esc(initials(visible_name)))
    banner_html = (
        f'<div class="banner"><img loading="lazy" decoding="async" src="{esc(assets["banner"])}" alt=""></div>\n'
        if assets.get("banner") else '<div class="banner"></div>\n')

    parts = [f"<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{esc(visible_name)} — archive</title>\n<style>{CSS}</style>\n</head>\n<body>\n"]
    parts.append(
        f'<header class="topbar"><div class="topbar-inner"><div class="logo" style="background:#16181c">{X_LOGO}</div>'
        f'<div><h1>{esc(visible_name)}</h1><p>{esc(kind_label)} · {total_posts} posts · exported {esc(exported_at)}</p></div></div></header>\n'
    )
    if archive_kind == "posts":
        parts.append(
            banner_html
            + f'<section class="profile"><div class="avatar-lg" style="background:{initials_color(handle or visible_name)}">{header_avatar}</div>'
            + f'<div class="name">{esc(visible_name)}</div>'
            + f'<div class="handle">@{esc(handle)}</div>'
            + (f'<div class="bio">{esc(profile.get("description"))}</div>' if profile.get("description") else "")
            + (f'<div class="meta"><span><b>{int(profile.get("followers_count") or 0):,}</b> followers</span>' if int(profile.get("followers_count") or 0) > 0 else '<div class="meta">')
            + f'<span><b>{total_posts}</b> posts archived</span><span class="note">cumulative archive</span></div></section>\n'
        )
    parts.append(f'<main class="feed">\n')

    conv_counts = collections.Counter(
        post.get("conversation_id") or "" for post in (*posts, *context_posts) if isinstance(post, dict)
    )

    for post in posts:
        parts.append(render_post(post, mode, assets, conv_counts))

    if context_posts:
        parts.append('<div class="context-archive" hidden>\n')
        for post in context_posts:
            parts.append(render_post(post, "context", assets, conv_counts))
        parts.append('</div>\n')

    context_note = f" · {context_ids:,} thread-context posts" if context_ids else ""
    parts.append(
        f'</main><footer class="footer">End of the archive · {total_posts} posts ({available} available, {unavailable} unavailable){context_note}<br>'
        'Generated by the local X Archive exporter — static page; one small inline script powers the media lightbox and the thread viewer.</footer>\n'
        + LIGHTBOX_HTML
        + THREAD_HTML
        + '</body>\n</html>\n'
    )

    written = 0
    with output.open("w", encoding="utf-8") as out:
        for part in parts:
            out.write(part)
            written += len(part)

    size_mb = written / (1024 * 1024)
    print(f"render_archive: wrote {output} ({size_mb:,.1f} MB, {len(posts)} posts, mode={mode})")


if __name__ == "__main__":
    main()
