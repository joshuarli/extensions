# Format

A `.u.zip.html` file renders as a page and extracts as a ZIP. This document describes the bytes so you can validate or recover them without the extension.

## Layout

The file holds three parts in order:

1. The saved page (HTML). It ends with the banner slot, the loader script, the archive index script, and the opening of one wrapper tag.
2. The ZIP bytes (stored entries, no compression).
3. The wrapper close tag.

The ZIP starts at byte `prefixLength` and uses file-absolute offsets, so `unzip -t` passes directly.

## ZIP entries

- `resources/<index>.<ext>`: captured images and fonts, byte-identical to the download. The extension in the name follows the served MIME type.
- `metadata.json`: the manifest below.

`prefixLength` is the byte length of part 1. Slice the file at that offset to recover a plain ZIP.

## metadata.json

- `generator`: always `extension-onefile`.
- `sourceUrl`: the saved tab URL.
- `capturedAtMs`: save time in milliseconds.
- `prefixLength`: byte offset where the ZIP starts.
- `entries`: one object per resource entry with `name`, `mime`, `size`, and `crc32`.
- `unresolved`: resources the capture could not reach, each with `url` and `reason`.

## Archive index

The prefix carries `<script id="onefile-metadata" type="application/json">` with `sourceUrl`, `capturedAtMs`, `unresolvedTotal`, a 25-item `unresolvedSample`, and entry names with MIME types. Angle brackets are `\u003c`-escaped so the block never breaks parsing.

## Loader behavior

When the archive URL serves its own bytes over `http(s)`, the loader extracts each entry, mints a blob URL per MIME type, and swaps the `resources/` references in place. When byte access is blocked (clean `file://`), it shows the banner with source, timestamp, and missing-file count, and swaps images for placeholders. The banner element is `<div id="onefile-banner">`. Page scripts from the saved tab are stripped at capture, so the loader is the only script that runs.

## Limits

Entry counts, sizes, and offsets must fit 32-bit ZIP fields; anything larger fails loudly before writing. The wrapper is the first of `<!--`, `script`, `style`, `noframes`, `noembed`, `iframe` whose terminator is absent from the ZIP bytes; if none fits, the build fails instead of emitting an unparseable file.
