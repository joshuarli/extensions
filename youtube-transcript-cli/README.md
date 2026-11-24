# YouTube transcript CLI

Fetch a YouTube transcript from the terminal using the same domain logic as the
YouTube Transcript feature in the suite:

```sh
pnpm youtube "https://www.youtube.com/watch?v=VIDEO_ID"
pnpm youtube "https://youtu.be/VIDEO_ID" --language=fr --format=srt
pnpm youtube "https://www.youtube.com/watch?v=VIDEO_ID" --format=json --out=transcript.json
```

`--format` is `markdown` (default, transcript with YAML frontmatter), `srt`, or
`json` (video id, metadata, text, and SRT). `--out` writes to a file instead of
stdout. `--language` selects a preferred caption language; leave it unset to
use YouTube's default.

The CLI uses YouTube's public `player`/`next`/caption endpoints directly over
HTTPS. It needs no browser, CDP endpoint, or extension. It does not sign in or
read cookies, so it can only read captions those endpoints expose publicly.
