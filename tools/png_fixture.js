// Test-only PNG encoder (8-bit RGB or RGBA). Keeps fixtures in memory; no files, KeyShot or network.
const zlib = require('zlib');
const { crc32 } = require('../server/png');
function chunk(type, data) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
// pixel(x, y) -> [r, g, b] or [r, g, b, a] with 0..255 values.
function encodePng(width, height, pixel, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = alpha ? 6 : 2;
  const raw = Buffer.alloc(height * (1 + width * channels));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = pixel(x, y), o = y * (width * channels + 1) + 1 + x * channels;
    for (let c = 0; c < channels; c++) raw[o + c] = Math.max(0, Math.min(255, Math.round(c < p.length ? p[c] : 255)));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { encodePng };
