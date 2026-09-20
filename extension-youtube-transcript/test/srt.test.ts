import test from "node:test";
import assert from "node:assert/strict";
import { buildSrt, formatSrtTimestamp } from "../src/srt.ts";

test("formats SRT timestamps as HH:MM:SS,mmm", () => {
  assert.equal(formatSrtTimestamp(0), "00:00:00,000");
  assert.equal(formatSrtTimestamp(65.123), "00:01:05,123");
  assert.equal(formatSrtTimestamp(3661), "01:01:01,000");
  assert.equal(formatSrtTimestamp(1.5), "00:00:01,500");
});

test("builds SRT from segments with estimated end times", () => {
  const srt = buildSrt([
      { start: 0, text: "Hello world." },
      { start: 5, text: "This is the second line." },
      { start: 10, text: "Third line." },
    ]),
    expected =
      "1\n00:00:00,000 --> 00:00:05,000\nHello world.\n\n2\n00:00:05,000 --> 00:00:10,000\nThis is the second line.\n\n3\n00:00:10,000 --> 00:00:15,000\nThird line.\n";
  assert.equal(srt, expected);
});

test("builds SRT for a single segment with default 5-second duration", () => {
  const srt = buildSrt([{ start: 42, text: "Only one line." }]);
  assert.equal(srt, "1\n00:00:42,000 --> 00:00:47,000\nOnly one line.\n");
});
