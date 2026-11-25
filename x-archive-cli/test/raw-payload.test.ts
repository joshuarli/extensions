import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTimeline } from "../../x-archive-core/src/parser.ts";
import { assembleBookmarkArchive } from "../../x-archive-core/src/storage.ts";
import { renderArchive } from "../../x-archive-core/src/render.ts";
import { FsBookmarksStore } from "../src/fs-store.ts";
import { writeJsonFile } from "../src/state.ts";

const savedStateRoot = process.env["X_ARCHIVE_STATE"];
let root: string | null = null;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
  if (savedStateRoot === undefined) delete process.env["X_ARCHIVE_STATE"];
  else process.env["X_ARCHIVE_STATE"] = savedStateRoot;
});

const observedAt = "2026-11-25T00:00:00.000Z";

const rawResult = {
  __typename: "Tweet",
  rest_id: "555",
  undeclared_graphql_field: { card_bindings: ["kept verbatim"] },
  core: { user_results: { result: { rest_id: "42", core: { screen_name: "alice", name: "Alice" } } } },
  legacy: {
    created_at: "Wed Oct 10 20:19:24 +0000 2018",
    full_text: "Raw post text with https://example.com",
    lang: "en",
    conversation_id_str: "555",
    favorite_count: 7,
  },
  card: { legacy: { name: "poll:card", binding_values: [{ key: "title", value: { string_value: "Raw card title" } }] } },
};

describe("raw tweet export fidelity", () => {
  it("carries an undeclared field from a GraphQL result through collection, storage and export into a rendered post", async () => {
    root = mkdtempSync(join(tmpdir(), "x-raw-export-test-"));
    process.env["X_ARCHIVE_STATE"] = root;
    const outDir = join(root, "out");

    const data = { data: { bookmark_timeline_v2: { timeline: { instructions: [{
      type: "TimelineAddEntries",
      entries: [{ entryId: "tweet-555", sortIndex: "999", content: { itemContent: { tweet_results: { result: rawResult } } } }],
    }] } } } };
    const collected = parseTimeline(data, observedAt);
    expect(collected.valid).toBe(true);
    expect(collected.bookmarks[0]?.raw_tweet).toEqual(rawResult);

    const store = new FsBookmarksStore("123");
    await store.savePage(collected.bookmarks);
    const stored = await store.allRecords();
    expect((stored[0] as Record<string, unknown>)["raw_tweet"]).toEqual(rawResult);

    writeFileSync(
      join(root, "x-archive", "stores", "123", "bookmarks.json"),
      JSON.stringify([{ ...(stored[0] as object), full_text: "stale stored text" }]),
    );
    const stale = await store.allRecords();
    const archive = assembleBookmarkArchive(stale, [], null, "123");
    const exported = archive.bookmarks[0]! as Record<string, unknown>;
    expect(exported["raw_tweet"]).toEqual(rawResult);
    expect(exported["undeclared_graphql_field"]).toBeUndefined();
    expect(exported["full_text"]).toBe("Raw post text with https://example.com");
    expect(exported["card"]).toMatchObject({ title: "Raw card title" });
    expect((archive.export_metadata as Record<string, unknown>)["schema_version"]).toBe(3);

    const jsonPath = join(outDir, "bookmarks.json");
    writeJsonFile(jsonPath, archive, 0o644);
    const written = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      bookmarks: Array<{ raw_tweet: { undeclared_graphql_field: unknown }; full_text: string }>;
    };
    expect(written.bookmarks[0]?.["raw_tweet"]["undeclared_graphql_field"]).toEqual({ card_bindings: ["kept verbatim"] });

    const rendered = await renderArchive({ folder: outDir, noFetch: true, textOnly: true });
    const html = readFileSync(rendered.output, "utf8");
    expect(rendered.posts).toBe(1);
    expect(html).toContain("Raw post text with");
    expect(html).toContain("Oct 10, 2018 · 8:19 PM");
  });
});
