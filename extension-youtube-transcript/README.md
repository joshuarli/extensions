# YouTube Transcript

An MV3 extension that copies the current YouTube video's transcript to the
clipboard. Also exposes a programmatic `getTranscript` action for headless
automation.

## Programmatic API

The extension declares `externally_connectable` on YouTube domains, so web
pages can call `chrome.runtime.sendMessage` directly.

From a script injected via CDP (e.g., `tab.evaluate()` in shadowdriver):

```js
(async () => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(EXTENSION_ID, { action: "getTranscript" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve((response && response.transcript) || null);
      }
    });
  });
})();
```

The extension ID can be discovered via CDP `Target.getTargets` — look for the
service worker target whose URL ends with `/service-worker.js`.

## Build

```bash
cd ..
deno task dist   # production builds all extensions
```

## Actions

| Action             | Source                      | Description                                               |
| ------------------ | --------------------------- | --------------------------------------------------------- |
| `copyTranscript`   | popup                       | Copies the transcript to clipboard                        |
| `getTranscript`    | externally_connectable page | Returns the transcript text via `sendResponse`            |
| `downloadFixtures` | popup (dev only)            | Downloads raw InnerTube response, transcript, caption XML |
