import assert from "node:assert/strict";
import { test } from "vitest";
import { parseArgs } from "../src/main.ts";

test("parses HN archive output options", () => {
  assert.deepEqual(parseArgs(["https://news.ycombinator.com/item?id=7", "--format=json", "--out", "hn.json"]), { id: 7, format: "json", out: "hn.json" });
  assert.deepEqual(parseArgs(["7"]), { id: 7, format: "html", out: undefined });
  for (const argv of [["https://example.com/item?id=7"], ["7", "--format=xml"], ["7", "8"], ["7", "--out"]]) assert.throws(() => parseArgs(argv));
});
