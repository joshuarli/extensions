import { mountYouTubeTranscriptOptions } from "../../extension-youtube-transcript/src/options.ts";
import { requiredElement } from "../../lib/extension-ui.ts";
import { xBookmarksExporterPath } from "./feature-paths.ts";

mountYouTubeTranscriptOptions(document);

const xOpen = requiredElement<HTMLButtonElement>(document, "[data-x-open]", "Options");

xOpen.addEventListener("click", () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL(xBookmarksExporterPath),
  });
});
