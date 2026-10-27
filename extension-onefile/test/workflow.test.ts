import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { saveTab, type SaveDependencies } from "../src/workflow.ts";
import { buildArchiveFilename } from "../src/filename.ts";
import { ResourceFetchError } from "../src/errors.ts";

const capturedAtMs = new Date(2024, 4, 1, 10, 20, 30).getTime(),
  imageBytes = new Uint8Array([137, 80, 78, 71]),
  pageHtml = '<!DOCTYPE html><html><head><title>Hello</title></head><body><img src="onefile-resource-0"></body></html>';

function payload() {
  return {
    pageUrl: "https://example.com/page",
    title: "Hello",
    capturedAtMs,
    pageHtml,
    resources: [{ url: "https://example.com/a.png", kind: "image" as const }],
    unresolved: [],
  };
}

function stubDeps(overrides: Partial<SaveDependencies> = {}): SaveDependencies & {
  states: { tabId: number; title: string; badge: string }[];
  downloads: { url: string; filename: string }[];
} {
  const states: { tabId: number; title: string; badge: string }[] = [],
    downloads: { url: string; filename: string }[] = [];
  return {
    states,
    downloads,
    executeCapture: async () => payload(),
    fetchResource: async () => ({ data: imageBytes, mime: "image/png" }),
    downloadDataUrl: async (url, filename) => {
      downloads.push({ url, filename });
      return 7;
    },
    loadLoaderSource: async () => "/*loader*/",
    setActionState: async (tabId, title, badge) => {
      states.push({ tabId, title, badge });
    },
    log: () => undefined,
    nowMs: () => capturedAtMs,
    ...overrides,
  };
}

describe("saveTab", () => {
  it("saves a trivial page through download with the chartered filename", async () => {
    const deps = stubDeps(),
      outcome = await Effect.runPromise(saveTab({ id: 3, url: "https://example.com/page", title: "Hello" }, deps, new Map()));
    expect(outcome).toEqual({
      filename: buildArchiveFilename("Hello", new Date(capturedAtMs)),
      downloadId: 7,
      missingCount: 0,
      degraded: false,
    });
    expect(outcome.filename.endsWith(".u.zip.html")).toBe(true);
    expect(deps.downloads).toHaveLength(1);
    expect(deps.downloads[0]?.filename).toBe(outcome.filename);
    expect(deps.states[0]).toMatchObject({ tabId: 3, title: "Onefile is saving…" });
    expect(deps.states.at(-1)).toMatchObject({ tabId: 3, badge: "" });
  });

  it("fails loudly with an action state on restricted pages", async () => {
    const deps = stubDeps({
      executeCapture: async () => {
        throw new Error("Cannot access a chrome:// URL");
      },
    });
    const error = await Effect.runPromise(
      saveTab({ id: 4, url: "chrome://extensions/" }, deps, new Map()).pipe(Effect.flip),
    );
    expect(error).toMatchObject({ _tag: "CaptureFailedError", kind: "tab-not-accessible" });
    expect(deps.states.at(-1)).toMatchObject({ tabId: 4, title: "Onefile cannot save this page", badge: "!" });
    expect(deps.downloads).toHaveLength(0);
  });

  it("rejects an invalid capture payload", async () => {
    const deps = stubDeps({ executeCapture: async () => ({ bogus: true }) });
    const error = await Effect.runPromise(saveTab({ id: 5 }, deps, new Map()).pipe(Effect.flip));
    expect(error).toMatchObject({ _tag: "CaptureFailedError", kind: "invalid-payload" });
  });

  it("refuses overlapping saves on the same tab but allows other tabs", async () => {
    const deps = stubDeps(),
      inFlight = new Map([[6, "6-old"]]);
    const error = await Effect.runPromise(saveTab({ id: 6 }, deps, inFlight).pipe(Effect.flip));
    expect(error).toMatchObject({ _tag: "SaveInProgressError" });
    expect(deps.states.at(-1)).toMatchObject({ title: "Onefile is already saving this tab" });
    const outcome = await Effect.runPromise(saveTab({ id: 9 }, deps, inFlight));
    expect(outcome.degraded).toBe(false);
    expect(inFlight.has(9)).toBe(false);
  });

  it("degrades loudly when a resource fetch fails", async () => {
    const deps = stubDeps({
      fetchResource: async (url) => {
        throw new ResourceFetchError(url, "bad-status", "HTTP 404");
      },
    });
    const outcome = await Effect.runPromise(saveTab({ id: 8 }, deps, new Map()));
    expect(outcome.degraded).toBe(true);
    expect(outcome.missingCount).toBe(1);
    expect(deps.states.at(-1)).toMatchObject({ tabId: 8, badge: "!" });
  });

  it("maps oversized archives to the too-large download error", async () => {
    const deps = stubDeps({
      fetchResource: async () => ({ data: new Uint8Array(2_000_000), mime: "image/png" }),
    });
    const error = await Effect.runPromise(saveTab({ id: 10 }, deps, new Map()).pipe(Effect.flip));
    expect(error).toMatchObject({ _tag: "DownloadFailedError", kind: "too-large" });
    expect(deps.states.at(-1)).toMatchObject({ title: "Onefile archive is too large to download here" });
  });
});
