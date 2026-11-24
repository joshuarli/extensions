# YouTube transcript core

Domain logic shared by the YouTube Transcript suite feature and
`youtube-transcript-cli`: URL parsing, InnerTube caption discovery, transcript
and chapter parsing, SRT and Markdown formatting, and the Effect-based fetch
workflow.

Browser-specific code (page DOM reading, popup, settings, background messages)
stays in `extension-youtube-transcript`. The suite composes that feature like
every other `extension-*` package.

`fetchVideoTranscript({ url, language, fetchImpl })` returns the video id,
metadata, and transcript text/SRT. Network and parsing failures are typed
`CaptionFetchError` or `NoTranscriptError`; a caller-supplied `fetchImpl` makes
the workflow testable with fixtures.
