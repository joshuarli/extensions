import { crc32 } from "./crc32.ts";

export interface ZipInputFile {
  name: string;
  data: Uint8Array;
  modifiedMs: number;
}

export interface ZipEntry {
  name: string;
  dataStart: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  method: number;
}

export interface ZipCentralDirectory {
  entries: ZipEntry[];
  centralStart: number;
  fileBytes: Uint8Array;
}

const localHeaderSignature = 0x04034b50,
  centralHeaderSignature = 0x02014b50,
  endSignature = 0x06054b50,
  maxEndsToScan = 65_535 + 22,
  maxEntries = 65_535,
  maxUint32 = 0xff_ff_ff_ff,
  utf8Flag = 1 << 11;

const textEncoder = new TextEncoder(), textDecoder = new TextDecoder("utf-8");

function dosDateTime(ms: number): { time: number; date: number } {
  const moment = new Date(ms),
    time = ((moment.getHours() << 11) | (moment.getMinutes() << 5) | (moment.getSeconds() >> 1)) & 0xffff,
    date =
      ((((moment.getFullYear() - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate()) &
        0xffff);
  return { time, date };
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export interface ZipBuildRequest {
  files: ZipInputFile[];
  archiveStartOffset: number;
}

export function assertZipLimits(
  files: ({ name: string; size: number } | ZipInputFile)[],
  archiveStartOffset: number,
): void {
  if (!Number.isSafeInteger(archiveStartOffset) || archiveStartOffset < 0 || archiveStartOffset > maxUint32) {
    throw new Error("ZIP archive start offset exceeds the 32-bit range");
  }
  if (files.length > maxEntries) {
    throw new Error(`ZIP archives hold at most ${maxEntries} entries`);
  }
  let cursor = archiveStartOffset;
  for (const file of files) {
    const size = "size" in file ? file.size : file.data.length;
    if (!Number.isSafeInteger(size) || size < 0 || size > maxUint32) {
      throw new Error(`ZIP entry ${file.name} exceeds the 32-bit size range`);
    }
    cursor += 30 + textEncoder.encode(file.name).length + size;
    if (cursor > maxUint32) throw new Error("ZIP archive data exceeds the 32-bit offset range");
  }
  for (const file of files) {
    cursor += 46 + textEncoder.encode(file.name).length;
    if (cursor > maxUint32) throw new Error("ZIP central directory exceeds the 32-bit offset range");
  }
  if (cursor + 22 > maxUint32) throw new Error("ZIP end record exceeds the 32-bit offset range");
}

export function buildStoredZip(request: ZipBuildRequest): Uint8Array {
  const { files, archiveStartOffset } = request;
  assertZipLimits(files, archiveStartOffset);
  const encoded = files.map((file) => ({ ...file, nameBytes: textEncoder.encode(file.name) })),
    headerSize = encoded.reduce((sum, file) => sum + 30 + file.nameBytes.length, 0),
    dataSize = encoded.reduce((sum, file) => sum + file.data.length, 0),
    centralSize = encoded.reduce((sum, file) => sum + 46 + file.nameBytes.length, 0),
    total = headerSize + dataSize + centralSize + 22,
    bytes = new Uint8Array(total),
    view = new DataView(bytes.buffer);
  let cursor = 0;
  const localOffsets: number[] = [];
  for (const file of encoded) {
    const needsUtf8 = [...file.name].some((unit) => unit.codePointAt(0) !== undefined && (unit.codePointAt(0) ?? 0) > 127);
    localOffsets.push(archiveStartOffset + cursor);
    const { time, date } = dosDateTime(file.modifiedMs);
    writeU32(view, cursor, localHeaderSignature);
    writeU16(view, cursor + 4, 20);
    writeU16(view, cursor + 6, needsUtf8 ? utf8Flag : 0);
    writeU16(view, cursor + 8, 0);
    writeU16(view, cursor + 10, time);
    writeU16(view, cursor + 12, date);
    writeU32(view, cursor + 14, crc32(file.data));
    writeU32(view, cursor + 18, file.data.length);
    writeU32(view, cursor + 22, file.data.length);
    writeU16(view, cursor + 26, file.nameBytes.length);
    writeU16(view, cursor + 28, 0);
    bytes.set(file.nameBytes, cursor + 30);
    bytes.set(file.data, cursor + 30 + file.nameBytes.length);
    cursor += 30 + file.nameBytes.length + file.data.length;
  }
  const centralStart = archiveStartOffset + cursor;
  encoded.forEach((file, index) => {
    const localOffset = localOffsets[index] ?? 0,
      { time, date } = dosDateTime(file.modifiedMs),
      needsUtf8 = [...file.name].some((unit) => (unit.codePointAt(0) ?? 0) > 127);
    writeU32(view, cursor, centralHeaderSignature);
    writeU16(view, cursor + 4, 20);
    writeU16(view, cursor + 6, 20);
    writeU16(view, cursor + 8, needsUtf8 ? utf8Flag : 0);
    writeU16(view, cursor + 10, 0);
    writeU16(view, cursor + 12, time);
    writeU16(view, cursor + 14, date);
    writeU32(view, cursor + 16, crc32(file.data));
    writeU32(view, cursor + 20, file.data.length);
    writeU32(view, cursor + 24, file.data.length);
    writeU16(view, cursor + 28, file.nameBytes.length);
    writeU16(view, cursor + 30, 0);
    writeU16(view, cursor + 32, 0);
    writeU16(view, cursor + 34, 0);
    writeU16(view, cursor + 36, 0);
    writeU32(view, cursor + 38, 0);
    writeU32(view, cursor + 42, localOffset);
    bytes.set(file.nameBytes, cursor + 46);
    cursor += 46 + file.nameBytes.length;
  });
  writeU32(view, cursor, endSignature);
  writeU16(view, cursor + 4, 0);
  writeU16(view, cursor + 6, 0);
  writeU16(view, cursor + 8, encoded.length);
  writeU16(view, cursor + 10, encoded.length);
  writeU32(view, cursor + 12, centralSize);
  writeU32(view, cursor + 16, centralStart);
  writeU16(view, cursor + 20, 0);
  return bytes;
}

function findEndOfCentralDirectory(fileBytes: Uint8Array): number {
  const tail = Math.min(fileBytes.length, maxEndsToScan);
  for (let offset = fileBytes.length - 22; offset >= fileBytes.length - tail; offset--) {
    if (
      fileBytes[offset] === 0x50 &&
      fileBytes[offset + 1] === 0x4b &&
      fileBytes[offset + 2] === 0x05 &&
      fileBytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end of central directory not found");
}

export function readStoredArchive(fileBytes: Uint8Array): ZipCentralDirectory {
  const endOffset = findEndOfCentralDirectory(fileBytes),
    view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength),
    count = view.getUint16(endOffset + 8, true),
    centralStart = view.getUint32(endOffset + 16, true);
  if (view.getUint16(endOffset + 10, true) !== count) {
    throw new Error("ZIP archive spans multiple disks");
  }
  const entries: ZipEntry[] = [];
  let cursor = centralStart;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== centralHeaderSignature) {
      throw new Error(`ZIP central entry ${index} has a bad signature`);
    }
    const nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true),
      method = view.getUint16(cursor + 10, true);
    entries.push({
      name: textDecoder.decode(fileBytes.subarray(cursor + 46, cursor + 46 + nameLength)),
      dataStart: view.getUint32(cursor + 42, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      crc: view.getUint32(cursor + 16, true),
      method,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, centralStart, fileBytes };
}

export function extractStoredEntry(directory: ZipCentralDirectory, name: string): Uint8Array {
  const entry = directory.entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`ZIP entry ${name} not found`);
  if (entry.method !== 0) throw new Error(`ZIP entry ${name} uses unsupported method ${entry.method}`);
  const view = new DataView(
    directory.fileBytes.buffer,
    directory.fileBytes.byteOffset,
    directory.fileBytes.byteLength,
  );
  if (view.getUint32(entry.dataStart, true) !== localHeaderSignature) {
    throw new Error(`ZIP entry ${name} has a bad local header`);
  }
  const nameLength = view.getUint16(entry.dataStart + 26, true),
    extraLength = view.getUint16(entry.dataStart + 28, true),
    dataStart = entry.dataStart + 30 + nameLength + extraLength,
    data = directory.fileBytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
    throw new Error(`ZIP entry ${name} failed integrity check`);
  }
  return data.slice();
}
