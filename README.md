# Browser extensions

This repository contains three Chromium Manifest V3 extensions:

- **Loupe** opens a clean reader view for the current page and can copy its content as HTML or Markdown.
- **Allow Right-Click** toggles right-click, text selection, copy, paste, and drag support on the current tab.
- **YouTube Transcript Copier** copies a video's transcript or SRT subtitles and supports a preferred transcript language. See the [YouTube user guide](extension-youtube-transcript/README.md).

## Install

Load the generated extension folders as unpacked extensions in a Chromium-based browser:

1. Open chrome://extensions and enable Developer mode.
2. Choose **Load unpacked** and select the generated folder for Loupe, Allow Right-Click, or YouTube Transcript Copier. Their folder names are `extension-loupe`, `extension-allow-right-click`, and `extension-youtube-transcript`.
3. After replacing a folder's contents, reload that extension on the extensions page.

The generated folders are not checked into the repository; obtain a built folder from the person who supplied the extension.

## Use

- Click **Loupe** in the toolbar to show or hide the reader. Its menu provides HTML and Markdown copying and an Obsidian action.
- Click **Allow Right-Click** to enable or disable it for the active tab.
- On a YouTube video, click **YouTube Transcript Copier**, then choose **Copy Transcript** or **Copy SRT Subtitles**. Use Settings to choose a preferred transcript language.
