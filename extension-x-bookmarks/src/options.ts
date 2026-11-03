import { errorMessage, requiredElement } from "../../lib/extension-ui.ts";
import { currentUserId, readCredentials } from "./capture.ts";
import { collect } from "./collector.ts";
import { assembleArchive, bookmarkCount, loadState, openArchive } from "./storage.ts";

const bookmarksContext = "X Bookmarks";

const accountElement = requiredElement<HTMLElement>(document, "#account", bookmarksContext);
const captureElement = requiredElement<HTMLElement>(document, "#capture", bookmarksContext);
const countElement = requiredElement<HTMLElement>(document, "#count", bookmarksContext);
const coverageElement = requiredElement<HTMLElement>(document, "#coverage", bookmarksContext);
const statusElement = requiredElement<HTMLOutputElement>(document, "#status", bookmarksContext);
const refreshButton = requiredElement<HTMLButtonElement>(document, "#refresh", bookmarksContext);
const collectButton = requiredElement<HTMLButtonElement>(document, "#collect", bookmarksContext);
const stopButton = requiredElement<HTMLButtonElement>(document, "#stop", bookmarksContext);
const downloadButton = requiredElement<HTMLButtonElement>(document, "#download", bookmarksContext);

let db: IDBDatabase | null = null;
let userId: string | null = null;
let controller: AbortController | null = null;
let busy = false;
let connectionReady = false;

function status(message: string): void {
  statusElement.textContent = message;
}

function setBusy(value: boolean): void {
  busy = value;
  refreshButton.disabled = value;
  collectButton.disabled = value || !connectionReady;
  downloadButton.disabled = value || !db;
  stopButton.disabled = !value;
}

async function refresh(): Promise<void> {
  if (busy) return;
  const activeId = await currentUserId();
  if (activeId !== userId) {
    db?.close();
    db = null;
    userId = activeId;
    if (userId) db = await openArchive(userId);
  }
  accountElement.textContent = userId ?? "Not signed in to X";
  if (!userId || !db) {
    captureElement.textContent = "Unavailable";
    countElement.textContent = "—";
    coverageElement.textContent = "—";
    connectionReady = false;
    collectButton.disabled = true;
    downloadButton.disabled = true;
    status("Sign in to X and open the bookmarks page.");
    return;
  }
  const credentials = await readCredentials(userId);
  const names = ["Bookmarks", "BookmarkFoldersSlice", "BookmarkFolderTimeline"];
  const available = names.filter((name) => !!credentials.queryIds[name]);
  captureElement.textContent = available.length
    ? available.join(", ") + (credentials.authorization ? "" : " (missing authorization header)")
    : "No requests captured — reload X bookmarks";
  connectionReady = !!credentials.queryIds["Bookmarks"] && !!credentials.authorization;
  collectButton.disabled = !connectionReady;
  downloadButton.disabled = false;
  countElement.textContent = String(await bookmarkCount(db));
  const previous = await loadState(db);
  coverageElement.textContent = previous
    ? "Bookmarks: " + previous.bookmarks + "; folders: " + previous.folders + ". " + previous.reason
    : "Not scanned";
}

refreshButton.addEventListener("click", () => {
  void refresh().catch((cause: unknown) => status("Connection error: " + errorMessage(cause)));
});

collectButton.addEventListener("click", () => {
  if (busy || !db || !userId) return;
  const archive = db;
  const account = userId;
  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true);
  void navigator.locks.request("x-bookmarks-collection-" + account, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another tab is collecting this account's bookmarks.");
    return collect({ db: archive, userId: account, signal, report: status });
  }).then((state) => {
    status("Collection finished. Bookmarks: " + state.bookmarks + "; folders: " + state.folders + ".");
  }).catch((cause: unknown) => {
    status("Collection stopped: " + errorMessage(cause) + ". Saved pages are retained.");
  }).finally(() => {
    controller = null;
    setBusy(false);
    void refresh().catch((cause: unknown) => status("Refresh error: " + errorMessage(cause)));
  });
});

stopButton.addEventListener("click", () => {
  controller?.abort();
  stopButton.disabled = true;
  status("Stopping. Saved pages will be retained.");
});

downloadButton.addEventListener("click", () => {
  if (busy || !db || !userId) return;
  const archive = db;
  const account = userId;
  setBusy(true);
  void (async () => {
    const data = await assembleArchive(archive, account);
    const filename = "x-bookmarks_" + account + "_" + new Date().toISOString().slice(0, 10) + ".json";
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: true, conflictAction: "uniquify" });
      status("JSON download requested: " + filename + ". Check browser downloads for completion.");
    } finally {
      // Chrome may still be displaying its save-as dialog when download() resolves.
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    }
  })().catch((cause: unknown) => {
    status("Export failed: " + errorMessage(cause));
  }).finally(() => {
    setBusy(false);
  });
});

void refresh().catch((cause: unknown) => status("Initialization failed: " + errorMessage(cause)));
