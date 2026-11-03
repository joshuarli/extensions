import { mountYouTubeTranscriptOptions } from "../../extension-youtube-transcript/src/options.ts";

mountYouTubeTranscriptOptions(document);

const xOpen = document.querySelector<HTMLButtonElement>("[data-x-open]");
if (!xOpen) throw new Error("Options markup is missing [data-x-open].");

xOpen.addEventListener("click", () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL("features/x-bookmarks/options.html"),
  });
});
