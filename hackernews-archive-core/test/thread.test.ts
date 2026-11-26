import assert from "node:assert/strict";
import { test } from "vitest";
import { collectThread, threadId, type HnItem } from "../src/thread.ts";
import { renderThread } from "../src/render.ts";

const fixture: readonly HnItem[] = [
  { id: 1, type: "story", title: "Ask HN: &amp; tea", kids: [3, 2], descendants: 4 },
  { id: 2, type: "comment", parent: 1, text: "second" },
  { id: 3, type: "comment", parent: 1, by: "alice", time: 1700000000, kids: [4], text: '<p>first &amp; <i>italic</i><a href="https://example.com/?a=1&amp;b=2" rel="nofollow">link</a>' },
  { id: 4, type: "comment", parent: 3, kids: [5], deleted: true },
  { id: 5, type: "comment", parent: 4, dead: true, text: "reply under deleted comment" },
];

function loader(items = fixture, calls: number[] = []) {
  return async (id: number) => {
    calls.push(id);
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`missing ${id}`);
    return item;
  };
}

test("accepts HN item links and numeric IDs, rejects other origins and ambiguous IDs", () => {
  assert.equal(threadId("https://news.ycombinator.com/item?id=123#456"), 123);
  assert.equal(threadId("123"), 123);
  for (const url of ["https://news.ycombinator.com.evil/item?id=1", "https://news.ycombinator.com/item?id=1&id=2", "https://user@news.ycombinator.com/item?id=1", "https://news.ycombinator.com/news?id=1", "0", "1.5", "9007199254740992"]) assert.equal(threadId(url), undefined);
});

test("resolves comment permalinks, traverses every edge once, renders ranked nesting and tombstones", async () => {
  const calls: number[] = [];
  const archive = await collectThread(5, loader(fixture, calls), "2026-01-01T00:00:00.000Z");
  assert.equal(archive.rootId, 1);
  assert.equal(archive.requestedId, 5);
  assert.deepEqual(archive.items.map((item) => item.id), [1, 3, 2, 4, 5]);
  assert.deepEqual(calls.sort(), [1, 2, 3, 4, 5]);
  const html = renderThread(archive);
  assert.ok(html.indexOf('id="item-3"') < html.indexOf('id="item-4"'));
  assert.ok(html.indexOf('id="item-5"') < html.indexOf('id="item-2"'));
  assert.match(html, /\[deleted\]/u);
  assert.match(html, /\[dead\]/u);
  assert.match(html, /href="https:\/\/example\.com\/\?a=1&amp;b=2"/u);
  const json = /<script type="application\/json" id="hn-archive">(.*?)<\/script>/su.exec(html)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), archive);
});

test("archives poll options and rejects missing or inconsistent edges", async () => {
  const poll: readonly HnItem[] = [{ id: 1, type: "poll", parts: [2], kids: [3] }, { id: 2, type: "pollopt", poll: 1, score: 8 }, { id: 3, deleted: true }];
  const result = await collectThread(2, loader(poll));
  assert.equal(result.items.length, 3);
  assert.match(renderThread(result), /Poll option/u);
  await assert.rejects(collectThread(1, loader(poll.slice(0, 2))), /missing 3/u);
  await assert.rejects(collectThread(1, loader([{ id: 1, type: "story", kids: [1] }])), /repeated/u);
  await assert.rejects(collectThread(1, loader([{ id: 1, type: "story", kids: [2] }, { id: 2, type: "comment", parent: 9 }])), /does not belong/u);
  await assert.rejects(collectThread(2, loader([{ id: 2, type: "comment", parent: 3 }, { id: 3, type: "comment", parent: 2 }])), /Cannot resolve/u);
  await assert.rejects(collectThread(2, loader([{ id: 1, type: "story" }, { id: 2, type: "comment", parent: 1 }])), /no longer/u);
});

test("bounds concurrency and preserves ordering across batches", async () => {
  const ids = Array.from({ length: 19 }, (_, i) => i + 2);
  let active = 0, peak = 0;
  const archive = await collectThread(1, async (id) => {
    if (id === 1) return { id, type: "story", kids: ids };
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, id % 3));
    active--;
    return { id, type: "comment", parent: 1 };
  });
  assert.equal(peak, 8);
  assert.deepEqual(archive.items.map((item) => item.id), [1, ...ids]);
});

test("escapes executable markup, preserves text, and safely embeds hostile JSON", async () => {
  const text = '<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">bad</a><a href="https://good.test" onclick="alert(4)">also bad</a>&lt;script&gt;';
  const archive = await collectThread(1, loader([{ id: 1, type: "story", title: '</script><img src=x>', url: "javascript:alert(5)", text }]));
  const html = renderThread(archive);
  assert.doesNotMatch(html, /<img|<script>alert|href="javascript:|<a href="https:\/\/good\.test"/u);
  assert.match(html, /&lt;img/u);
  assert.match(html, /default-src 'none'/u);
  assert.equal((html.match(/<\/script>/gu) ?? []).length, 1);
});
