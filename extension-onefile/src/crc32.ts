const table = (() => {
  const entries = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let remainder = value;
    for (let bit = 0; bit < 8; bit++) {
      remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
    }
    entries[value] = remainder;
  }
  return entries;
})();

export function crc32(data: Uint8Array): number {
  let remainder = 0xffffffff;
  for (const byte of data) {
    remainder = (table[(remainder ^ byte) & 0xff] ?? 0) ^ (remainder >>> 8);
  }
  return (remainder ^ 0xffffffff) >>> 0;
}
