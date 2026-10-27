import { buildStoredZip } from "./zip.ts";
import { crc32 } from "./crc32.ts";

export interface PolyglotResource {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface PolyglotUnresolved {
  url: string;
  reason: string;
}

export interface PolyglotRequest {
  pageHtml: string;
  loaderSource: string;
  resources: PolyglotResource[];
  sourceUrl: string;
  capturedAtMs: number;
  unresolved: PolyglotUnresolved[];
}

export interface PolyglotMetadata {
  generator: string;
  sourceUrl: string;
  capturedAtMs: number;
  prefixLength: number;
  entries: { name: string; mime: string; size: number; crc32: number }[];
  unresolved: PolyglotUnresolved[];
}

export interface PolyglotArchive {
  fileBytes: Uint8Array;
  prefixLength: number;
  metadata: PolyglotMetadata;
}

const textEncoder = new TextEncoder();

const bodyClosePattern = /<\/body\s*>/iu,
  htmlClosePattern = /<\/html\s*>/iu,
  headOpenPattern = /<head[^>]*>/iu,
  metadataElementId = "onefile-metadata";

export interface EmbeddedArchiveIndex {
  sourceUrl: string;
  capturedAtMs: number;
  unresolvedTotal: number;
  unresolvedSample: PolyglotUnresolved[];
  entries: { name: string; mime: string }[];
}

export function injectMetadataSlot(pageHtml: string, index: EmbeddedArchiveIndex): string {
  const jsonText = JSON.stringify(index).replace(/</g, "\\u003c"),
    slot = `<script id="${metadataElementId}" type="application/json">${jsonText}</script>`,
    headOpen = pageHtml.match(headOpenPattern);
  if (headOpen?.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${pageHtml.slice(0, insertAt)}${slot}${pageHtml.slice(insertAt)}`;
  }
  return `${slot}${pageHtml}`;
}

export function injectLoaderSlot(pageHtml: string): string {
  const markers = '<div id="onefile-banner" hidden="hidden"></div><script id="onefile-loader"></script>',
    bodyClose = pageHtml.match(bodyClosePattern);
  if (bodyClose?.index !== undefined) {
    return `${pageHtml.slice(0, bodyClose.index)}${markers}${pageHtml.slice(bodyClose.index)}`;
  }
  const htmlClose = pageHtml.match(htmlClosePattern);
  if (htmlClose?.index !== undefined) {
    return `${pageHtml.slice(0, htmlClose.index)}${markers}${pageHtml.slice(htmlClose.index)}`;
  }
  return `${pageHtml}${markers}`;
}

export function fillLoaderSlot(slottableHtml: string, loaderSource: string): string {
  return slottableHtml.replace(
    '<script id="onefile-loader"></script>',
    () => `<script id="onefile-loader">\n${loaderSource}\n</script>`,
  );
}

export interface ZipWrapper {
  open: string;
  close: string;
}

const zipWrappers: { open: string; close: string; forbidden: string[] }[] = [
  { open: "<!--", close: "-->", forbidden: ["<!--", "-->", "--!>"] },
  { open: '<script type="onefile-data">', close: "</script>", forbidden: ["</script"] },
  { open: '<style type="onefile-data">', close: "</style>", forbidden: ["</style"] },
  { open: "<noframes>", close: "</noframes>", forbidden: ["</noframes"] },
  { open: "<noembed>", close: "</noembed>", forbidden: ["</noembed"] },
  { open: "<iframe>", close: "</iframe>", forbidden: ["</iframe"] },
];

export function containsAsciiInsensitive(haystack: Uint8Array, needle: string): boolean {
  const folded = needle.toLowerCase();
  outer: for (let index = 0; index + needle.length <= haystack.length; index++) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (String.fromCharCode(haystack[index + offset] ?? 0).toLowerCase() !== folded[offset]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

export function selectZipWrapper(zipBytes: Uint8Array): ZipWrapper | null {
  for (const wrapper of zipWrappers) {
    if (wrapper.forbidden.every((pattern) => !containsAsciiInsensitive(zipBytes, pattern))) {
      return { open: wrapper.open, close: wrapper.close };
    }
  }
  return null;
}

export function buildPolyglot(request: PolyglotRequest): PolyglotArchive {
  const baseMetadata: Omit<PolyglotMetadata, "prefixLength"> = {
      generator: "extension-onefile",
      sourceUrl: request.sourceUrl,
      capturedAtMs: request.capturedAtMs,
      entries: request.resources.map((resource) => ({
        name: resource.name,
        mime: resource.mime,
        size: resource.data.length,
        crc32: crc32(resource.data),
      })),
      unresolved: request.unresolved,
    },
    resourceFiles = request.resources.map((resource) => ({
      name: resource.name,
      data: resource.data,
      modifiedMs: request.capturedAtMs,
    })),
    pageWithSlots = fillLoaderSlot(
      injectMetadataSlot(injectLoaderSlot(request.pageHtml), {
        sourceUrl: request.sourceUrl,
        capturedAtMs: request.capturedAtMs,
        unresolvedTotal: request.unresolved.length,
        unresolvedSample: request.unresolved.slice(0, 25),
        entries: request.resources.map((resource) => ({ name: resource.name, mime: resource.mime })),
      }),
      request.loaderSource,
    );
  let archiveStartOffset = 0,
    prefixLengthGuess = 0;
  for (let attempt = 0; attempt < zipWrappers.length + 2; attempt++) {
    const metadataBytes = textEncoder.encode(JSON.stringify({ ...baseMetadata, prefixLength: prefixLengthGuess })),
      zipBytes = buildStoredZip({
        files: [...resourceFiles, { name: "metadata.json", data: metadataBytes, modifiedMs: request.capturedAtMs }],
        archiveStartOffset,
      }),
      wrapper = selectZipWrapper(zipBytes);
    if (!wrapper) throw new Error("No HTML wrapper hides this archive without breaking parsing.");
    const prefixBytes = textEncoder.encode(`${pageWithSlots}${wrapper.open}`);
    if (prefixBytes.length === archiveStartOffset && prefixLengthGuess === prefixBytes.length) {
      const withPrefix = new Uint8Array(prefixBytes.length + zipBytes.length);
      withPrefix.set(prefixBytes, 0);
      withPrefix.set(zipBytes, prefixBytes.length);
      const fileBytes = new Uint8Array(withPrefix.length + wrapper.close.length);
      fileBytes.set(withPrefix, 0);
      fileBytes.set(textEncoder.encode(wrapper.close), withPrefix.length);
      return {
        fileBytes,
        prefixLength: prefixBytes.length,
        metadata: { ...baseMetadata, prefixLength: prefixBytes.length },
      };
    }
    archiveStartOffset = prefixBytes.length;
    prefixLengthGuess = prefixBytes.length;
  }
  throw new Error("Archive offsets did not converge on a parse-safe wrapper.");
}
