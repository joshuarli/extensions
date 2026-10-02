import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildTranscript,
  extractChapters,
  formatTimestamp,
  groupTranscriptSegments,
  parseTranscriptXml,
} from "../src/transcript.ts";
import { pickCaptionTrack } from "../src/captions.ts";

test("formats timestamps as M:SS and H:MM:SS", () => {
  assert.equal(formatTimestamp(0), "0:00");
  assert.equal(formatTimestamp(65), "1:05");
  assert.equal(formatTimestamp(3661), "1:01:01");
});

test("parses srv3 captions and preserves the language code", () => {
  const result = parseTranscriptXml(
    `<?xml version="1.0"?>
    <timedtext><body>
      <p t="0"><s>Hello </s><s>world.</s></p>
      <p t="5000"><s>Second line.</s></p>
      <p t="65000"><s>After one minute</s></p>
    </body></timedtext>`,
    "en",
  );

  assert.equal(result!.languageCode, "en");
  assert.equal(
    result!.text,
    "**0:00** · Hello world.\n**0:05** · Second line.\n**1:05** · After one minute",
  );
});

test("parses legacy text captions", () => {
  const result = parseTranscriptXml(
    `<transcript>
    <text start="0" dur="5">Hello world.</text>
    <text start="5.5" dur="3">Second line.</text>
  </transcript>`,
    "es",
  );

  assert.equal(result!.languageCode, "es");
  assert.match(result!.text, /\*\*0:00\*\* · Hello world\./);
  assert.match(result!.text, /\*\*0:05\*\* · Second line\./);
});

test("decodes named, decimal, and hexadecimal entities", () => {
  const result = parseTranscriptXml(
    `<timedtext><body>
    <p t="0"><s>it&apos;s &amp; that&#39;s &quot;quoted.&quot;</s></p>
    <p t="1000"><s>&#x2019;smart&#x2019; &#8212; dash</s></p>
  </body></timedtext>`,
    "en",
  );

  assert.equal(result!.text, "**0:00** · it's & that's \"quoted.\"\n**0:01** · ’smart’ — dash");
});

test("falls back to raw paragraph text and returns undefined for empty XML", () => {
  assert.equal(parseTranscriptXml("<timedtext><body></body></timedtext>", "en"), undefined);
  const result = parseTranscriptXml(
    '<timedtext><body><p t="0">Plain text without s tags</p></body></timedtext>',
    "en",
  );
  assert.equal(result!.text, "**0:00** · Plain text without s tags");
});

test("collapses caption newlines to spaces", () => {
  const result = parseTranscriptXml(
    `<timedtext><body>
    <p t="0">I couldn&#39;t quite get
      it to do what I wanted.</p>
  </body></timedtext>`,
    "en",
  );
  assert.match(result!.text, /I couldn&apos;t|I couldn't/);
  assert.doesNotMatch(result!.text, /\n\n/);
});

test("groups ordinary caption windows by sentence", () => {
  const groups = groupTranscriptSegments([
    { start: 0, text: "The quick brown" },
    { start: 2, text: "fox jumps over the lazy dog." },
    { start: 4, text: "Then it ran" },
    { start: 6, text: "away quickly." },
  ]);
  assert.deepEqual(
    groups.map((group) => group.text),
    ["The quick brown fox jumps over the lazy dog.", "Then it ran away quickly."],
  );
});

test("groups speaker turns and strips speaker markers", () => {
  const groups = groupTranscriptSegments([
    { start: 0, text: "Welcome to the show." },
    { start: 3, text: ">> Tell me about your work." },
    { start: 6, text: "Well I started" },
    { start: 9, text: "back in 2010." },
    { start: 12, text: ">> That's interesting." },
  ]);
  assert.deepEqual(
    groups.map((group) => group.text),
    [
      "Welcome to the show.",
      "Tell me about your work.",
      "Well I started back in 2010.",
      "That's interesting.",
    ],
  );
  assert.equal(groups[1]!.speaker, 0);
  assert.equal(groups[3]!.speaker, 1);
  assert.equal(groups[1]!.speakerChange, true);
});

test("splits a long affirmative response into speaker turns", () => {
  const groups = groupTranscriptSegments([
    { start: 0, text: "Can that work?" },
    {
      start: 3,
      text: ">> Yeah. This is a long answer with enough words to trigger the affirmative split and continue explaining all of the important details for the listener.",
    },
    { start: 8, text: "More context follows here for the answer." },
  ]);
  assert.equal(groups[1]!.text, "Yeah.");
  assert.match(groups[2]!.text, /^This is a long answer/);
  assert.equal(groups[1]!.speaker, 0);
  assert.equal(groups[2]!.speaker, 1);
});

test("handles CJK punctuation and long unpunctuated groups", () => {
  const groups = groupTranscriptSegments([
    { start: 0, text: "这是第一句话关于人工智能。" },
    { start: 2, text: "这是第二句关于机器学习。" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.text),
    ["这是第一句话关于人工智能。", "这是第二句关于机器学习。"],
  );
});

test("keeps sparse caption windows together until a sentence ends", () => {
  const groups = groupTranscriptSegments([
    { start: 43, text: "Today I have the pleasure of interviewing George Church." },
    { start: 46, text: "I don't know how to introduce you." },
    { start: 65, text: ">> By what year would it be" },
    {
      start: 76,
      text: "the case that, if you make it to that year, technology in bio will keep progressing to such",
    },
    { start: 92, text: "an extent that your lifespan will increase by" },
    { start: 103, text: "a year, every year, or more?" },
  ]);
  assert.equal(
    groups[2]!.text,
    "By what year would it be the case that, if you make it to that year, technology in bio will keep progressing to such an extent that your lifespan will increase by a year, every year, or more?",
  );
});

test("builds chapter headings", () => {
  const result = buildTranscript(
    [{ start: 0, text: "<script>", speakerChange: false }],
    [{ title: "Intro & context", start: 0 }],
  );
  assert.match(result.text, /### Intro & context/);
});

test("extracts explicit and engagement-panel chapters", () => {
  const chapters = extractChapters({
    playerOverlays: {
      playerOverlayRenderer: {
        decoratedPlayerBarRenderer: {
          decoratedPlayerBarRenderer: {
            playerBar: {
              multiMarkersPlayerBarRenderer: {
                markersMap: [
                  {
                    value: {
                      chapters: [
                        {
                          chapterRenderer: {
                            title: { simpleText: "Intro" },
                            timeRangeStartMillis: 0,
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    engagementPanels: [
      {
        engagementPanelSectionListRenderer: {
          content: {
            macroMarkersListRenderer: {
              contents: [
                {
                  macroMarkersListItemRenderer: {
                    title: { simpleText: "Topic" },
                    timeDescription: { simpleText: "1:05" },
                  },
                },
              ],
            },
          },
        },
      },
    ],
  });
  assert.deepEqual(chapters, [
    { title: "Intro", start: 0 },
    { title: "Topic", start: 65 },
  ]);
});

test("selects preferred languages and prefers manual captions", () => {
  const tracks = [
    { languageCode: "en", kind: "asr" },
    { languageCode: "zh-Hant" },
    { languageCode: "zh" },
    { languageCode: "en" },
  ];
  assert.equal(pickCaptionTrack(tracks, "zh-CN")!.languageCode, "zh");
  assert.equal(pickCaptionTrack(tracks, "en")!.kind, undefined);
  assert.equal(pickCaptionTrack([{ languageCode: "en", kind: "asr" }])!.kind, "asr");
});
