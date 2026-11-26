import assert from "node:assert/strict";
import { Effect } from "effect";
import { test } from "vitest";
import { decodeItem, fetchThread } from "../src/client.ts";

test("validates API items while allowing additional fields and deleted tombstones", () => {
  assert.equal(decodeItem({ id: 7, type: "story", extra: 1 }, 7).id, 7);
  assert.equal(decodeItem({ id: 8, deleted: true }, 8).deleted, true);
  for (const payload of [null, { id: 8, type: "story" }, { id: 7 }, { id: 7, type: "story", kids: [0] }, { id: 7, type: "comment", time: "bad" }]) {
    assert.throws(() => decodeItem(payload, 7));
  }
});

test("uses the public endpoint without credentials and retries a transient response", async () => {
  const calls: string[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    if (calls.length === 1) return new Response("busy", { status: 503 });
    return Response.json({ id: 7, type: "story" });
  };
  const result = await Effect.runPromise(fetchThread(7, fake));
  assert.equal(result.rootId, 7);
  assert.deepEqual(calls, Array(2).fill("https://hacker-news.firebaseio.com/v0/item/7.json"));
});

test("fails a whole capture if a referenced item is missing", async () => {
  const fake: typeof fetch = async (input) => Response.json(String(input).endsWith("/7.json")
    ? { id: 7, type: "story", kids: [8] } : null);
  await assert.rejects(Effect.runPromise(fetchThread(7, fake)), /HN item 8 is unavailable/u);
});
