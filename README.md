# Browser extensions

This repository builds one Chromium Manifest V3 extension with four features:

- **Allow Right-Click** toggles right-click, text selection, copy, paste, and drag support on the current tab.
- **YouTube Transcript Copier** copies a video's transcript or SRT subtitles and supports a preferred transcript language. See the [YouTube user guide](extension-youtube-transcript/README.md).
- **X Bookmarks** exports X bookmarks and folders to a cumulative local JSON archive. See the [X Bookmarks guide](extension-x-bookmarks/README.md).
- **Onefile** saves the active tab as an offline-openable universal self-extracting ZIP (`.u.zip.html`). See the [Onefile guide](extension-onefile/README.md).

The four `extension-*` packages remain separate source and test units; [extension-suite](extension-suite) composes them into one worker, manifest, popup, and options page.

## Install

Load the generated extension folder as an unpacked extension in a Chromium-based browser:

1. Open chrome://extensions and enable Developer mode.
2. Choose **Load unpacked** and select `dist/extension-suite` for a production build or `build/extension-suite` for a development build.
3. After replacing the folder's contents, reload the extension on the extensions page.

The generated folders are not checked into the repository; obtain a built folder from the person who supplied the extension.

The unified extension has one extension ID. Storage, IndexedDB archives, and external YouTube API callers from the old standalone extensions do not carry over automatically. Export X bookmarks to JSON before switching, and update external scripts with the new ID.

## Use

Click the toolbar icon to open the feature hub:

- **Allow Right-Click** enables or disables right-click restoration for the active tab.
- **Onefile** saves the active tab as a `.u.zip.html` file.
- **YouTube Transcript** appears on YouTube pages and copies the transcript or SRT subtitles.
- **X Bookmarks** opens the bookmark exporter.
- **All settings** opens the preferred transcript language and the X Bookmarks exporter link.
