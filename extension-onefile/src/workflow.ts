import { Effect, Schema } from "effect";
import {
  CapturePayloadSchema,
  type CapturePayload,
} from "./message-contract.ts";
import {
  ArchiveBuildError,
  CaptureFailedError,
  DownloadFailedError,
  SaveInProgressError,
  type CaptureFailureKind,
} from "./errors.ts";
import { buildArchiveFilename, resourceEntryName } from "./filename.ts";
import { buildPolyglot, type PolyglotResource } from "./polyglot.ts";
import { missingResourceToken, resourceTokenPrefix } from "./inject/capture.ts";
import { capturePolicy } from "./policy.ts";
import { downloadArchive } from "./downloads.ts";

export interface SaveTab {
  id?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
}

export interface SaveDependencies {
  executeCapture: (tabId: number, saveId: string) => Promise<unknown>;
  fetchResource: (url: string) => Promise<{ data: Uint8Array; mime: string }>;
  downloadDataUrl: (url: string, filename: string) => Promise<number>;
  loadLoaderSource: () => Promise<string>;
  setActionState: (tabId: number, title: string, badge: string) => Promise<void>;
  log: (...args: readonly unknown[]) => void;
  nowMs: () => number;
}

export interface SaveOutcome {
  filename: string;
  downloadId: number;
  missingCount: number;
  degraded: boolean;
}

export type SaveError =
  | CaptureFailedError
  | ArchiveBuildError
  | DownloadFailedError
  | SaveInProgressError;

const restrictedPagePattern = /^(chrome|chrome-extension|edge|about|view-source|devtools|chrome-search):/i,
  accessDeniedPattern = /cannot access|no tab with id|frame was removed|receiving end does not exist/i;

function classifyCaptureFailure(
  tabId: number,
  tabUrl: string | undefined,
  error: unknown,
): CaptureFailedError {
  const message = error instanceof Error ? error.message : String(error);
  const kind: CaptureFailureKind =
    (tabUrl !== undefined && restrictedPagePattern.test(tabUrl)) || accessDeniedPattern.test(message)
      ? "tab-not-accessible"
      : "capture-rejected";
  return new CaptureFailedError(tabId, kind, `Capture failed for tab ${tabId}: ${message}`, error);
}

function failureTitle(error: SaveError): string {
  if (error._tag === "SaveInProgressError") return "Onefile is already saving this tab";
  if (error._tag === "CaptureFailedError") {
    return error.kind === "tab-not-accessible" ? "Onefile cannot save this page" : "Onefile capture failed";
  }
  if (error._tag === "ArchiveBuildError") return "Onefile could not build the archive";
  if (error.kind === "too-large") return "Onefile archive is too large to download here";
  return "Onefile download failed";
}

export function saveTab(
  tab: SaveTab,
  deps: SaveDependencies,
  inFlight: Map<number, string>,
): Effect.Effect<SaveOutcome, SaveError> {
  if (tab.id === undefined) {
    return Effect.fail(new CaptureFailedError(-1, "capture-rejected", "Save needs a tab id."));
  }
  const tabId = tab.id;
  if (inFlight.has(tabId)) {
    return Effect.promise(() =>
      deps.setActionState(tabId, "Onefile is already saving this tab", "!").catch(() => undefined),
    ).pipe(Effect.andThen(Effect.fail(new SaveInProgressError(tabId))));
  }
  const saveId = `${tabId}-${deps.nowMs()}`;
  inFlight.set(tabId, saveId);
  const release = Effect.sync(() => {
    if (inFlight.get(tabId) === saveId) inFlight.delete(tabId);
  });
  return Effect.gen(function* () {
  yield* Effect.tryPromise({
      try: () => deps.setActionState(tabId, "Onefile is saving…", "…"),
      catch: (error) => classifyCaptureFailure(tabId, tab.url, error),
    });
    const rawPayload = yield* Effect.tryPromise({
      try: () => deps.executeCapture(tabId, saveId),
      catch: (error) => classifyCaptureFailure(tabId, tab.url, error),
    });
    const payload: CapturePayload = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(CapturePayloadSchema)(rawPayload),
      catch: (error) =>
        new CaptureFailedError(tabId, "invalid-payload", "Capture returned a bad payload.", error),
    });
    const loaderSource = yield* Effect.tryPromise({
      try: () => deps.loadLoaderSource(),
      catch: (error) => new ArchiveBuildError("Could not load the archive viewer.", error),
    });
    const fetched = yield* Effect.forEach(
      payload.resources,
      (reference, index) =>
        Effect.tryPromise({
          try: () => deps.fetchResource(reference.url),
          catch: (error) => error,
          }).pipe(
            Effect.map((value) => ({ index, url: reference.url, fetched: true as const, value })),
            Effect.catch((error: unknown) => Effect.succeed({ index, url: reference.url, fetched: false as const, value: error })),
          ),
        { concurrency: capturePolicy.resourceFetchConcurrency },
      );
      let pageHtml = payload.pageHtml;
      const zipResources: PolyglotResource[] = [],
        unresolved: { url: string; reason: string }[] = [...payload.unresolved];
      for (const outcome of fetched) {
        const token = `${resourceTokenPrefix}${outcome.index}`;
        if (!outcome.fetched) {
          pageHtml = pageHtml.replaceAll(token, missingResourceToken);
          const reason = outcome.value instanceof Error ? outcome.value.message : String(outcome.value);
          unresolved.push({ url: outcome.url, reason });
          continue;
        }
        const name = resourceEntryName(outcome.index, outcome.url, outcome.value.mime);
        pageHtml = pageHtml.replaceAll(token, name);
        zipResources.push({ name, mime: outcome.value.mime, data: outcome.value.data });
      }
      const archive = yield* Effect.try({
        try: () =>
          buildPolyglot({
            pageHtml,
            loaderSource,
            resources: zipResources,
            sourceUrl: payload.pageUrl,
            capturedAtMs: payload.capturedAtMs,
            unresolved,
          }),
        catch: (error) => new ArchiveBuildError("Could not assemble the archive bytes.", error),
      });
      const filename = buildArchiveFilename(payload.title || tab.title || "", new Date(payload.capturedAtMs)),
        downloadId = yield* downloadArchive(
          { downloadDataUrl: (url, name) => deps.downloadDataUrl(url, name) },
          { filename, bytes: archive.fileBytes },
        );
      const degraded = unresolved.length > 0;
      yield* Effect.tryPromise({
        try: () =>
          deps.setActionState(
            tabId,
            degraded ? `Onefile saved with ${unresolved.length} missing file(s)` : `Onefile saved ${filename}`,
            degraded ? "!" : "",
          ),
        catch: (error) => classifyCaptureFailure(tabId, tab.url, error),
      });
      return { filename, downloadId, missingCount: unresolved.length, degraded };
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        deps.log("Onefile save failed:", error);
        deps.setActionState(tabId, failureTitle(error), "!").catch(() => undefined);
      }),
    ),
    Effect.ensuring(release),
  );
}

export function scheduleTitleRevert(
  deps: Pick<SaveDependencies, "setActionState" | "log">,
  tabId: number,
  title: string,
): void {
  setTimeout(() => {
    deps.setActionState(tabId, title, "").catch((error: unknown) => {
      deps.log("Onefile title revert failed:", error);
    });
  }, capturePolicy.saveTitleRevertMs);
}
