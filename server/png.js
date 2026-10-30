// png.js - minimal PNG decoder + image statistics (no dependencies), for exposure measurement.
// Supports 8/16-bit grey, grey+alpha, RGB, RGBA, non-interlaced (what KeyShot screenshots are).
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function decode(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0; const idat = [];
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw new Error('truncated PNG');
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > buf.length || (type === 'IHDR' && len !== 13)) throw new Error('invalid PNG chunk');
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG not supported');
  if (!w || !h || w * h > 24000000 || ![8,16].includes(depth) || !idat.length) throw new Error('unsupported PNG dimensions or depth');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]; if (!ch) throw new Error('PNG colour type ' + ctype + ' not supported');
  const bpp = Math.max(1, (ch * depth) / 8), stride = Math.ceil((w * ch * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: h * (stride + 1) }), out = Buffer.alloc(h * stride);
  if (raw.length !== h * (stride + 1)) throw new Error('invalid PNG pixel data');
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    if (f > 4) throw new Error('invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  // normalise to 8-bit RGB accessor
  const px = (x, y) => {
    const o = y * stride + x * ch * (depth / 8), s = depth === 16 ? 2 : 1;
    if (ch <= 2) { const g = out[o]; return [g, g, g]; }
    return [out[o], out[o + s], out[o + 2 * s]];
  };
  const alpha = (x, y) => (ch === 4 ? out[y * stride + x * ch * (depth / 8) + 3 * (depth === 16 ? 2 : 1)] : ch === 2 ? out[y * stride + x * ch * (depth / 8) + (depth === 16 ? 2 : 1)] : 255);
  return { w, h, px, alpha, hasAlpha: ch === 4 || ch === 2 };
}

// Statistics over a region given as fractions of the image: {x0,x1,y0,y1}. Luma is on the gamma-encoded 0..1 values.
function stats(img, r = { x0: 0.33, x1: 0.67, y0: 0.14, y1: 0.8 }, step = 3) {
  const lumas = []; let sr = 0, sg = 0, sb = 0, n = 0, clip = 0;
  const X0 = Math.floor(r.x0 * img.w), X1 = Math.floor(r.x1 * img.w), Y0 = Math.floor(r.y0 * img.h), Y1 = Math.floor(r.y1 * img.h);
  for (let y = Y0; y < Y1; y += step) for (let x = X0; x < X1; x += step) {
    const [R, G, B] = img.px(x, y), l = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    lumas.push(l); sr += R; sg += G; sb += B; n++; if (l > 0.97) clip++;
  }
  lumas.sort((a, b) => a - b);
  const q = p => lumas[Math.min(lumas.length - 1, Math.floor(p * lumas.length))];
  return { n, mean: lumas.reduce((a, b) => a + b, 0) / n, p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99), clipFrac: clip / n, rgb: [sr / n, sg / n, sb / n].map(v => Math.round(v)) };
}

// Product-only statistics: estimate the backdrop luma from the image corners, then keep only pixels that differ from
// it by more than `tol` inside the product region.  Falls back to the whole region when the product is almost the
// same tone as the backdrop (e.g. clear glass on white).
function productStats(img, r = { x0: 0.30, x1: 0.70, y0: 0.12, y1: 0.82 }, tol = 0.05, step = 3) {
  const corner = (x0, y0) => stats(img, { x0, x1: x0 + 0.1, y0, y1: y0 + 0.1 }, 4).p50;
  const bgs = [corner(0.01, 0.01), corner(0.89, 0.01), corner(0.01, 0.89), corner(0.89, 0.89)].sort((a, b) => a - b);
  const bg = (bgs[1] + bgs[2]) / 2, lumas = []; let n = 0, clip = 0, tot = 0;
  const X0 = Math.floor(r.x0 * img.w), X1 = Math.floor(r.x1 * img.w), Y0 = Math.floor(r.y0 * img.h), Y1 = Math.floor(r.y1 * img.h);
  for (let y = Y0; y < Y1; y += step) for (let x = X0; x < X1; x += step) {
    const [R, G, B] = img.px(x, y), l = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255; tot++;
    if (Math.abs(l - bg) > tol) { lumas.push(l); n++; if (l > 0.97) clip++; }
  }
  if (n < 0.12 * tot) return { ...stats(img, r, step), bg, share: n / tot, fallback: true };
  lumas.sort((a, b) => a - b);
  const q = p => lumas[Math.min(lumas.length - 1, Math.floor(p * lumas.length))];
  return { n, bg, share: n / tot, p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99), clipFrac: clip / n, fallback: false };
}

// Encode a display-space image { w, h, rgb: Float32Array in 0..1 } as an 8-bit RGB PNG (for saved before/after outputs).
function encodeRgb(img) {
  const chunk = (type, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(img.w); header.writeUInt32BE(img.h, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(img.h * (1 + img.w * 3));
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) for (let c = 0; c < 3; c++)
    raw[y * (img.w * 3 + 1) + 1 + x * 3 + c] = Math.max(0, Math.min(255, Math.round(img.rgb[(y * img.w + x) * 3 + c] * 255)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { decode, stats, productStats, crc32, encodeRgb };
