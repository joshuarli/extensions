import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { main } from "../src/main.ts";

const fixture: typeof fetch = async (input) => Response.json(String(input).endsWith("/7.json")
  ? { id: 7, type: "story", title: "Example", kids: [8] }
  : { id: 8, type: "comment", parent: 7, text: "Hello" });

test("publishes complete HTML and JSON without replacing existing output or leaving staging files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hn-archive-test-"));
  try {
    const html = join(dir, "thread.html"), json = join(dir, "thread.json");
    assert.equal(await main(["7", "--out", html], fixture), 0);
    const initial = await readFile(html, "utf8");
    assert.match(initial, /Hello/u);
    assert.equal(await main(["8", "--format=json", "--out", json], fixture), 0);
    const archive: unknown = JSON.parse(await readFile(json, "utf8"));
    assert.deepEqual(archive, {
      format: "hackernews-thread", version: 1, requestedId: 8, rootId: 7,
      capturedAt: (archive as { capturedAt: string }).capturedAt,
      items: [{ id: 7, type: "story", title: "Example", kids: [8] }, { id: 8, type: "comment", parent: 7, text: "Hello" }],
    });
    assert.equal(await main(["8", "--out", html], fixture), 1);
    assert.equal(await readFile(html, "utf8"), initial);
    assert.equal(await main(["7", "--out", join(dir, "failed.html")], async () => Response.json(null)), 1);
    assert.deepEqual((await readdir(dir)).sort(), ["thread.html", "thread.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
