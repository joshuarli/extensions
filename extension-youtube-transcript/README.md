# YouTube Transcript Copier

Copies the current YouTube video's transcript as Markdown with video metadata in YAML frontmatter, or copies subtitles in SRT format.

For browser installation, follow the [repository README](../README.md).

## Use

Open a YouTube video and click the extension icon. Choose **Copy Transcript** or **Copy SRT Subtitles**. In **Settings**, enter a preferred transcript language such as `en` or `zh-CN`; leave the field blank to use YouTube's default caption selection.

## Message API

Pages on `https://www.youtube.com`, `https://m.youtube.com`, or `https://youtube.com` can message the extension using its ID. External requests are bound to the sending browser tab: omit `tabId`, or provide the sending tab's ID. A request cannot read a transcript from another tab. `getTranscript` returns Markdown in the `transcript` field; `getSubtitle` returns SRT in the same field. Errors return an `error` field and may include `errorDetail`.

A script injected through CDP can call the API like this:

```js
(async () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(EXTENSION_ID, { action: "getTranscript" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || response.error) {
        reject(new Error(response?.error || "No response from the extension."));
      } else {
        resolve(response.transcript);
      }
    });
  });
})();
```

Use `{ action: "getSubtitle" }` to receive SRT instead. The extension ID can be found through CDP `Target.getTargets` by locating the service worker target whose URL ends with `/service-worker.js`.
