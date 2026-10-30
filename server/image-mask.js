// Shared measurement masks. One mask definition is applied to BOTH the reference photograph and the KeyShot render, so
// the two sides score the same kind of pixels. Coordinates are relative to the measurement rectangle: u, v in [0, 1] from
// its top-left corner. On the reference the rectangle is the user's region; on the render it is the projected-bounds
// target region. Matching them assumes the camera is aligned to the reference (see camera-alignment.js, research E05).
const crypto = require('crypto');

const MAX_POINTS = 64, MAX_EXCLUDES = 8;
const KINDS = ['rect', 'polygon'];
const unit = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) { const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length]; sum += x0 * y1 - x1 * y0; }
  return Math.abs(sum) / 2;
}
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
function selfIntersects(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) === 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
  }
  return false;
}
function polygon(points, label, minArea) {
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_POINTS
      || !points.every(p => Array.isArray(p) && p.length === 2 && unit(p[0]) && unit(p[1])))
    throw new Error(`${label} needs 3 to ${MAX_POINTS} points, each [u, v] within 0 to 1.`);
  const copy = points.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
  if (selfIntersects(copy)) throw new Error(`${label} must not cross itself.`);
  if (polygonArea(copy) < minArea) throw new Error(`${label} is too small or degenerate.`);
  return copy;
}

// Returns a canonical mask or null (no mask). Throws a user-facing error for malformed input.
function normalizeMask(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('A measurement mask must be an object.');
  const allowed = ['version', 'signature', 'kind', 'points', 'exclude', 'exclude_transparent'];   // version and signature allow re-normalizing a canonical mask
  const extra = Object.keys(input).find(k => !allowed.includes(k));
  if (extra) throw new Error(`Unknown mask field: ${extra}.`);
  const kind = input.kind || (input.points ? 'polygon' : 'rect');
  if (!KINDS.includes(kind)) throw new Error('Mask kind must be rect or polygon.');
  if (kind === 'rect' && input.points != null) throw new Error('A rect mask covers the whole measurement rectangle and takes no points.');
  const exclude = input.exclude == null ? [] : input.exclude;
  if (!Array.isArray(exclude) || exclude.length > MAX_EXCLUDES) throw new Error(`A mask can exclude at most ${MAX_EXCLUDES} regions.`);
  if (input.exclude_transparent != null && typeof input.exclude_transparent !== 'boolean') throw new Error('exclude_transparent must be true or false.');
  const mask = { version: 1, kind, ...(kind === 'polygon' ? { points: polygon(input.points, 'The mask polygon', 0.01) } : {}),
    exclude: exclude.map((p, i) => polygon(p, `Excluded region ${i + 1}`, 0.0005)), exclude_transparent: input.exclude_transparent === true };
  mask.signature = crypto.createHash('sha256').update(JSON.stringify({ ...mask, signature: undefined })).digest('hex').slice(0, 16);
  return mask;
}

// Even-odd point-in-polygon test.
function inPolygon(u, v, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function contains(mask, u, v) {
  if (!mask) return true;
  if (mask.kind === 'polygon' && !inPolygon(u, v, mask.points)) return false;
  return !mask.exclude.some(p => inPolygon(u, v, p));
}

// Visit every pixel of a w x h image whose center lies in the normalized rectangle AND inside the mask.
// fn(x, y, u, v) receives rectangle-relative coordinates. `step` subsamples exactly like the existing metrics.
function forEachMasked(mask, rect, w, h, step, fn) {
  const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0;
  for (let y = Math.max(0, Math.ceil(rect.y0 * h)); y < Math.min(h, rect.y1 * h); y += step)
    for (let x = Math.max(0, Math.ceil(rect.x0 * w)); x < Math.min(w, rect.x1 * w); x += step) {
      const u = ((x + 0.5) / w - rect.x0) / rw, v = ((y + 0.5) / h - rect.y0) / rh;
      if (u < 0 || u > 1 || v < 0 || v > 1 || !contains(mask, u, v)) continue;
      fn(x, y, u, v);
    }
}

// Identical statistics for both sides. samples: [{ u, v, l, rgb: [r, g, b] }] in display space, 0..1.
function maskedStatistics(samples) {
  if (!samples.length) return null;
  const sorted = samples.map(s => s.l).sort((a, b) => a - b);
  const q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const cut = q(0.9), bright = samples.filter(s => s.l >= cut);
  const mean = key => samples.reduce((n, s) => n + s[key], 0) / samples.length;
  const rgb = [0, 1, 2].map(c => samples.reduce((n, s) => n + s.rgb[c], 0) / samples.length);
  const spread = q(0.95) - q(0.05);
  return { sampled_pixels: samples.length, p05_luma: q(0.05), p50_luma: q(0.5), p95_luma: q(0.95), mean_luma: mean('l'), mean_rgb: rgb,
    highlight: spread < 0.02 ? null : { x: bright.reduce((n, s) => n + s.u, 0) / bright.length, y: bright.reduce((n, s) => n + s.v, 0) / bright.length } };
}

module.exports = { normalizeMask, contains, inPolygon, polygonArea, forEachMasked, maskedStatistics, MAX_POINTS, MAX_EXCLUDES };
