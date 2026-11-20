import { afterEach, expect, it, vi } from "vitest";
import { NetworkCaptures, recipe, reuseRecipe } from "../src/discovery.ts";
import { captureRequest, mergeCapture, type Credentials } from "../../x-archive-core/src/capture.ts";
import { collect, type ArchiveDeps, type BookmarksStore } from "../../x-archive-core/src/collector.ts";
import type { ScanState } from "../../x-archive-core/src/storage.ts";

const token = "synthetic-authorization";
const url = (operation: string) => `https://x.com/i/api/graphql/query_${operation}/${operation}?features=%7B%22flag%22%3Atrue%7D`;
const request = (id: string, operation: string) => ({ requestId: id, documentURL: "https://x.com/i/bookmarks", request: { url: url(operation), headers: { "x-client-uuid": "synthetic-uuid" } } });
const extra = (id: string) => ({ requestId: id, headers: { authorization: token, cookie: "synthetic-cookie" } });

afterEach(() => vi.unstubAllGlobals());

it("correlates CDP events in either order and matches extension capture for folder operations", () => {
  const observer = new NetworkCaptures();
  let expected: Credentials = { queryIds: {}, features: {} };
  for (const [index, operation] of ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"].entries()) {
    const id = String(index);
    if (index % 2) { observer.extra(extra(id)); observer.request(request(id, operation)); }
    else { observer.request(request(id, operation)); observer.extra(extra(id)); }
    const captured = captureRequest(url(operation), "https://x.com", [
      { name: "x-client-uuid", value: "synthetic-uuid" }, { name: "authorization", value: token }, { name: "cookie", value: "synthetic-cookie" },
    ]);
    expect(captured).not.toBeNull();
    expected = mergeCapture(expected, captured!);
  }
  expect(observer.credentials()).toEqual(expected);
  expect(JSON.stringify(recipe(observer.credentials()))).not.toContain("synthetic-");
});

it("rejects requests originating outside X", () => {
  const observer = new NetworkCaptures();
  observer.request({ ...request("1", "Bookmarks"), documentURL: "https://example.com/" });
  observer.extra(extra("1"));
  expect(observer.credentials().queryIds).toEqual({});
});

it("reuses a stored recipe after restart while obtaining fresh authorization", () => {
  const stored = recipe({ authorization: "old-token", queryIds: { Bookmarks: "old-query" }, features: {} });
  const result = reuseRecipe(stored, { authorization: token, queryIds: { Bookmarks: "new-query" }, features: {} });
  expect(result.authorization).toBe(token);
  expect(result.queryIds["Bookmarks"]).toBe("old-query");
  expect(JSON.stringify(stored)).not.toContain("old-token");
});

function setup(initial: Credentials, refresh?: ArchiveDeps["refreshCredentials"]) {
  let saved: ScanState | null = null;
  const store: BookmarksStore = {
    savePage: async () => {}, saveFolders: async () => {}, loadState: async () => saved,
    saveState: async (state) => { saved = structuredClone(state); },
  };
  const deps: ArchiveDeps = {
    credentials: async () => initial, currentUserId: async () => "123", readProfileTarget: async () => null,
    writeProfileTarget: async () => {}, session: async () => ({ userId: "123", csrfToken: "synthetic-csrf" }),
    ...(refresh ? { refreshCredentials: refresh } : {}),
  };
  return { store, deps, saved: () => saved };
}
const timeline = { data: { bookmark_timeline_v2: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [] }] } } } };
const folders = { data: { viewer: { user_results: { result: { bookmark_collections_slice: { items: [] } } } } } };
const run = (fixture: ReturnType<typeof setup>) => collect({ userId: "123", ...fixture, signal: new AbortController().signal, report: () => {} });

it("refreshes a rejected stale recipe once and reports missing folders as partial", async () => {
  const credentials: Credentials = { authorization: token, queryIds: { Bookmarks: "stale" }, features: {} };
  const refresh = vi.fn(async () => { Object.assign(credentials, { queryIds: { Bookmarks: "fresh" } }); });
  const fixture = setup(credentials, refresh);
  const fetcher = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(timeline), { status: String(input).includes("/stale/") ? 404 : 200 }));
  vi.stubGlobal("fetch", fetcher);
  const state = await run(fixture);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(state).toMatchObject({ bookmarks: "complete", folders: "not_checked", reason: "folder_query_not_captured" });
  expect(fixture.saved()).toMatchObject({ reason: "folder_query_not_captured" });
});

it("stops after one rediscovery if the replacement is also stale", async () => {
  const credentials: Credentials = { authorization: token, queryIds: { Bookmarks: "stale" }, features: {} };
  const refresh = vi.fn(async () => {});
  const fixture = setup(credentials, refresh);
  const fetcher = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(run(fixture)).rejects.toMatchObject({ kind: "query" });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fixture.saved()).toMatchObject({ bookmarks: "partial", folders: "not_checked" });
});

it("reports complete only after the folder list is checked", async () => {
  const credentials: Credentials = { authorization: token, queryIds: { Bookmarks: "q", BookmarkFoldersSlice: "f" }, features: {} };
  const fixture = setup(credentials);
  vi.stubGlobal("fetch", async (input: string | URL | Request) => new Response(JSON.stringify(String(input).includes("BookmarkFoldersSlice") ? folders : timeline), { status: 200 }));
  expect(await run(fixture)).toMatchObject({ bookmarks: "complete", folders: "complete", reason: "complete" });
});
