# Browser extensions

This repository builds one Chromium Manifest V3 extension with five features:

- **Allow Right-Click** toggles right-click, text selection, copy, paste, and drag support on the current tab.
- **YouTube Transcript Copier** copies a video's transcript or SRT subtitles and supports a preferred transcript language. See the [YouTube user guide](extension-youtube-transcript/README.md).
- **X Archive support** passively captures X GraphQL credentials for `x-archive-cli`; it has no user interface. See the [support guide](extension-x-archive/README.md).
- **Onefile** saves the active tab as an offline-openable universal self-extracting ZIP (`.u.zip.html`). See the [Onefile guide](extension-onefile/README.md).
- **ChatGPT Organizer** reviews, marks and bulk-organizes ChatGPT conversations with a resumable queue and a backup before deletion. See the [ChatGPT Organizer guide](extension-chatgpt/README.md).

The `extension-*` packages remain separate source and test units; [extension-suite](extension-suite) composes every one of them into one worker, manifest, popup, and options page. There is no separately installable feature extension: if a directory starts with `extension-`, it belongs in the suite.

Run any tool through `pnpm tools <command>` (`x`, `onefile`, `youtube`, `chatgpt`, `ig`), or use the individual `pnpm x`, `pnpm x:discover`, `pnpm onefile`, `pnpm youtube`, and `pnpm ig` scripts. The CLI tools live outside the extension: **x-archive-cli** archives X bookmarks, likes and profiles ([CLI guide](x-archive-cli/README.md)), **x-discovery-cli** finds and follows X discovery candidates ([SDK guide](docs/x-discover/README.md)), **onefile-cli** saves a page as the same `.u.zip.html` archive ([CLI guide](onefile-cli/README.md)), **chatgpt-archive-cli** archives ChatGPT conversations ([CLI guide](chatgpt-archive-cli/README.md)), **instagram-archive-cli** archives posts, reels and saved collections ([CLI guide](instagram-archive-cli/README.md)), and **youtube-transcript-cli** fetches a transcript or SRT from a YouTube URL ([CLI guide](youtube-transcript-cli/README.md)). Each has a matching `*-core` domain package where the browser extension and CLI share logic.

## Install

Load the generated extension folder as an unpacked extension in a Chromium-based browser:

1. Open chrome://extensions and enable Developer mode.
2. Choose **Load unpacked** and select `dist/extension-suite` for a production build or `build/extension-suite` for a development build.
3. After replacing the folder's contents, reload the extension on the extensions page.

The generated folders are not checked into the repository; obtain a built folder from the person who supplied the extension.

The unified extension's ID is pinned by a manifest key, so a CLI hot-load from its cache directory gets the same ID on every machine. Storage, IndexedDB archives, and external YouTube API callers from the old standalone extensions do not carry over automatically. Export X bookmarks to JSON before switching, and update external scripts with the new ID (`iollcidiekkhoepdpmghaihbjccfkhla`).

## Use

Click the toolbar icon to open the feature hub:

- **Allow Right-Click** enables or disables right-click restoration for the active tab.
- **Onefile** saves the active tab as a `.u.zip.html` file.
- **ChatGPT Organizer** opens the review dashboard in a new tab. Sign in at chatgpt.com first.
- **YouTube Transcript** appears on YouTube pages and copies the transcript or SRT subtitles.
- **All settings** opens the preferred transcript language options.
