// Dependency-free, lossless-channel PNG transformations for derived PBR maps.
// Source files are never overwritten. Unsupported PNG features fail closed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('./png');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const name = Buffer.from(type), body = Buffer.concat([name, data]);
  const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(body), data.length + 8); return out;
}
function readPng(buf) {
  if (!Buffer.isBuffer(buf) || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Texture editing currently supports non-interlaced 8-bit PNG maps only. Your source was not changed.');
  let pos = 8, ihdr, compressed = [], color = false;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    if (pos + len + 12 > buf.length) throw new Error('Invalid or truncated PNG. Source was not changed.');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    if (type === 'IDAT') compressed.push(data);
    if (type === 'PLTE') color = true;
    pos += len + 12; if (type === 'IEND') break;
  }
  if (!ihdr || !compressed.length || ihdr[8] !== 8 || ihdr[9] !== 0 || ihdr[12] !== 0 || color)
    throw new Error('Texture edits support 8-bit grayscale PNG maps (non-interlaced). This map cannot be safely transformed here; source unchanged.');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), stride = w;
  if (!w || !h || w * h > 16000000) throw new Error('Texture dimensions exceed the safe 16-megapixel edit limit. Source unchanged.');
  const raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: h * (stride + 1) });
  if (raw.length !== h * (stride + 1)) throw new Error('Invalid PNG pixel data. Source unchanged.');
  const pixels = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], at = y * (stride + 1) + 1, row = y * stride;
    if (f > 4) throw new Error('Unsupported PNG row filter. Source unchanged.');
    for (let x = 0; x < w; x++) {
      const a = x ? pixels[row + x - 1] : 0, b = y ? pixels[row - stride + x] : 0, c = x && y ? pixels[row - stride + x - 1] : 0;
      let v = raw[at + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[row + x] = v & 255;
    }
  }
  return { ihdr, w, h, pixels };
}
function encode(img) {
  const raw = Buffer.alloc(img.h * (img.w + 1));
  for (let y = 0; y < img.h; y++) { raw[y * (img.w + 1)] = 0; img.pixels.copy(raw, y * (img.w + 1) + 1, y * img.w, (y + 1) * img.w); }
  return Buffer.concat([SIGNATURE, chunk('IHDR', img.ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function transform(img, operation, amount) {
  const p = img.pixels, gain = amount == null ? 1.5 : amount;
  if (operation === 'invert') { for (let i = 0; i < p.length; i++) p[i] = 255 - p[i]; }
  else if (operation === 'contrast') {
    if (gain < 0.25 || gain > 4) throw new Error('Contrast amount must be between 0.25 and 4.');
    for (let i = 0; i < p.length; i++) p[i] = Math.max(0, Math.min(255, Math.round(128 + (p[i] - 128) * gain)));
  } else if (operation === 'tile-offset') {
    const ox = Math.floor(img.w / 2), oy = Math.floor(img.h / 2), out = Buffer.alloc(p.length);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out[((y + oy) % img.h) * img.w + ((x + ox) % img.w)] = p[y * img.w + x];
    out.copy(p);
  } else if (operation === 'horizontal-grain' || operation === 'vertical-grain') {
    const horizontal = operation === 'horizontal-grain', radius = Math.max(2, Math.min(32, Math.round(gain)));
    const out = Buffer.alloc(p.length);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      let sum = 0, n = 0;
      for (let d = -radius; d <= radius; d++) { const xx = Math.max(0, Math.min(img.w - 1, x + (horizontal ? d : 0))), yy = Math.max(0, Math.min(img.h - 1, y + (horizontal ? 0 : d))); sum += p[yy * img.w + xx]; n++; }
      out[y * img.w + x] = Math.round(sum / n);
    }
    out.copy(p);
  } else throw new Error('Unknown map operation.');
}
function safeStem(value) { return String(value || 'texture').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'texture'; }
function editTexture({ sourcePath, outputDir, operation, amount }) {
  const src = path.resolve(sourcePath), dest = path.resolve(outputDir);
  if (!fs.existsSync(src) || path.extname(src).toLowerCase() !== '.png') throw new Error('Select an imported PNG texture map. Original files are never changed.');
  const img = readPng(fs.readFileSync(src)); transform(img, operation, amount);
  fs.mkdirSync(dest, { recursive: true });
  const suffix = operation + (amount == null ? '' : '-' + String(amount).replace(/[^0-9.-]/g, ''));
  const out = path.join(dest, `${safeStem(path.basename(src, '.png'))}__${suffix}.png`);
  if (path.resolve(out) === src) throw new Error('Refusing to overwrite the source texture.');
  fs.writeFileSync(out, encode(img), { flag: 'wx' });
  return { path: out, width: img.w, height: img.h, operation, source: src };
}
module.exports = { editTexture, readPng, encode, transform };
