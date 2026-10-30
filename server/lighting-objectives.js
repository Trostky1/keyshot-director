// Interpretable image objectives for reference reconstruction: highlight components (position, area, extent), shadow
// direction, regional tone/colour structure and edge sharpness, each with a bounded robust loss. Lower is better.
// EXPERIMENTAL (research E07): developed against synthetic images and adversarial fixtures only. It is NOT wired into the
// app, it is not a similarity percentage, and the combined number has no absolute meaning; use it to rank candidates that
// share one reference, mask and renderer.
// Inputs are display-space images { w, h, rgb: Float32Array(3*w*h) in 0..1 } (see colour-contract.js: never linear EXR data).
const { decode } = require('./png');

const WEIGHTS = Object.freeze({ highlights: 0.2, shadow: 0.1, tone_structure: 0.15, multiscale_tone: 0.25, exposure: 0.1, colour_variation: 0.05, sharpness: 0.15, global_tint: 0 });
const SCALES = [2, 4, 8];
const GRID = 4;

function fromPng(buffer) {
  const img = decode(buffer), rgb = new Float32Array(img.w * img.h * 3);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const p = img.px(x, y); for (let c = 0; c < 3; c++) rgb[(y * img.w + x) * 3 + c] = p[c] / 255; }
  return { w: img.w, h: img.h, rgb };
}
function assertImage(img, name) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || !(img.rgb?.length === img.w * img.h * 3)) throw new Error(`${name} is not a valid image.`);
}
const rho = x => x * x / (1 + x * x);          // bounded robust loss: quadratic near 0, saturating at 1 for gross errors
const lumaAt = (img, i) => 0.2126 * img.rgb[i * 3] + 0.7152 * img.rgb[i * 3 + 1] + 0.0722 * img.rgb[i * 3 + 2];
function lumaImage(img, mask) {
  const n = img.w * img.h, l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = lumaAt(img, i);
  const idx = []; for (let i = 0; i < n; i++) if (!mask || mask[i]) idx.push(i);
  return { l, idx };
}
function quantile(sorted, f) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))]; }

// ---- highlights -------------------------------------------------------------------------------------------------
function highlightBlobs(img, mask = null, { maxBlobs = 6 } = {}) {
  const { l, idx } = lumaImage(img, mask);
  if (!idx.length) return { blobs: [], threshold: null, area_pixels: 0 };
  const sorted = idx.map(i => l[i]).sort((a, b) => a - b);
  const median = quantile(sorted, 0.5), top = quantile(sorted, 0.99);
  if (top - median < 0.08) return { blobs: [], threshold: null, area_pixels: idx.length };      // no distinct highlight
  const threshold = Math.max(quantile(sorted, 0.94), median + 0.15);
  const seen = new Uint8Array(img.w * img.h), blobs = [];
  for (const start of idx) {
    if (seen[start] || l[start] < threshold) continue;
    const stack = [start], pixels = []; seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(); pixels.push(i);
      const x = i % img.w, y = (i / img.w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < img.w - 1 ? i + 1 : -1, y > 0 ? i - img.w : -1, y < img.h - 1 ? i + img.w : -1])
        if (j >= 0 && !seen[j] && (!mask || mask[j]) && l[j] >= threshold) { seen[j] = 1; stack.push(j); }
    }
    if (pixels.length < Math.max(3, idx.length * 0.001)) continue;
    let mass = 0, cx = 0, cy = 0;
    for (const i of pixels) { const m = l[i] - threshold + 1e-3; mass += m; cx += m * ((i % img.w) + 0.5); cy += m * (((i / img.w) | 0) + 0.5); }
    cx /= mass; cy /= mass;
    let vx = 0, vy = 0; for (const i of pixels) { vx += ((i % img.w) + 0.5 - cx) ** 2; vy += (((i / img.w) | 0) + 0.5 - cy) ** 2; }
    blobs.push({ centroid: { x: cx / img.w, y: cy / img.h }, area: pixels.length / idx.length, mass,
      extent: { x: Math.sqrt(vx / pixels.length) / img.w + 1e-4, y: Math.sqrt(vy / pixels.length) / img.h + 1e-4 } });
  }
  blobs.sort((a, b) => b.mass - a.mass);
  const kept = blobs.slice(0, maxBlobs), total = kept.reduce((n, b) => n + b.mass, 0) || 1;
  return { blobs: kept.map(b => ({ ...b, mass_share: b.mass / total })), threshold, area_pixels: idx.length };
}
function highlightLoss(ref, rnd) {
  const a = ref.blobs, b = rnd.blobs;
  if (!a.length && !b.length) return { loss: 0, matched: 0, reference_count: 0, render_count: 0 };
  if (!a.length || !b.length) return { loss: 1, matched: 0, reference_count: a.length, render_count: b.length };
  const cost = (p, q) => rho(Math.hypot(p.centroid.x - q.centroid.x, p.centroid.y - q.centroid.y) / 0.08)
    + 0.5 * rho(Math.abs(Math.log(q.area / p.area)) / 0.7) + 0.5 * rho(Math.abs(Math.log(Math.hypot(q.extent.x, q.extent.y) / Math.hypot(p.extent.x, p.extent.y))) / 0.4);
  const pairs = []; a.forEach((p, i) => b.forEach((q, j) => pairs.push({ i, j, c: cost(p, q) / 2 })));
  pairs.sort((x, y) => x.c - y.c);
  const usedA = new Set(), usedB = new Set(); let loss = 0, matched = 0;
  for (const p of pairs) if (!usedA.has(p.i) && !usedB.has(p.j)) { usedA.add(p.i); usedB.add(p.j); loss += a[p.i].mass_share * p.c; matched++; }
  // An unmatched component is a missing or spurious highlight: charged at full weight so count mismatch is never free.
  a.forEach((p, i) => { if (!usedA.has(i)) loss += p.mass_share; });
  b.forEach((q, j) => { if (!usedB.has(j)) loss += q.mass_share * 0.5 * (a.length ? 1 : 0); });
  return { loss: Math.min(1, loss), matched, reference_count: a.length, render_count: b.length };
}

// ---- shadow direction -------------------------------------------------------------------------------------------
// Direction from the centre of the measured region to the centroid of its clearly dark pixels: where the shadow mass falls.
// Assumes the region is centred on the object, as a projected-bounds target is; an off-centre region biases the angle.
function shadowDescriptor(img, mask = null) {
  const { l, idx } = lumaImage(img, mask);
  if (!idx.length) return null;
  const sorted = idx.map(i => l[i]).sort((a, b) => a - b), median = quantile(sorted, 0.5);
  const dark = Math.min(quantile(sorted, 0.15), median * 0.6);
  if (median - quantile(sorted, 0.05) < 0.06) return { magnitude: 0, angle_deg: null, area: 0 };
  let dx = 0, dy = 0, dn = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of idx) {
    const x = ((i % img.w) + 0.5) / img.w, y = (((i / img.w) | 0) + 0.5) / img.h;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    if (l[i] <= dark) { dx += x; dy += y; dn++; }
  }
  if (!dn) return { magnitude: 0, angle_deg: null, area: 0 };
  const vx = dx / dn - (x0 + x1) / 2, vy = dy / dn - (y0 + y1) / 2, magnitude = Math.hypot(vx, vy);
  return { magnitude, angle_deg: Math.atan2(vy, vx) * 180 / Math.PI, area: dn / idx.length };
}
function shadowLoss(a, b) {
  if (!a || !b) return 1;
  const aOn = a.magnitude > 0.03, bOn = b.magnitude > 0.03;
  if (!aOn && !bOn) return 0;
  if (aOn !== bOn) return Math.min(1, 0.5 + 0.5 * rho(Math.max(a.magnitude, b.magnitude) / 0.1));
  let d = Math.abs(a.angle_deg - b.angle_deg); if (d > 180) d = 360 - d;
  return Math.min(1, 0.6 * rho(d / 40) + 0.2 * rho(Math.abs(a.magnitude - b.magnitude) / 0.1) + 0.2 * rho(Math.abs(Math.log((b.area + 1e-3) / (a.area + 1e-3))) / 0.7));
}

// ---- regional tone / colour -------------------------------------------------------------------------------------
function regionGrid(img, mask = null, grid = GRID) {
  const cells = Array.from({ length: grid * grid }, () => ({ n: 0, l: 0, rgb: [0, 0, 0] }));
  let total = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = y * img.w + x; if (mask && !mask[i]) continue;
    const cell = cells[Math.min(grid - 1, (y * grid / img.h) | 0) * grid + Math.min(grid - 1, (x * grid / img.w) | 0)];
    cell.n++; cell.l += lumaAt(img, i); for (let c = 0; c < 3; c++) cell.rgb[c] += img.rgb[i * 3 + c]; total++;
  }
  if (!total) return null;
  const mean = [0, 0, 0]; let meanL = 0;
  for (const c of cells) { meanL += c.l; for (let k = 0; k < 3; k++) mean[k] += c.rgb[k]; }
  meanL /= total; for (let k = 0; k < 3; k++) mean[k] /= total;
  const chroma = rgb => { const s = rgb[0] + rgb[1] + rgb[2] + 1e-6; return [rgb[0] / s, rgb[1] / s]; };
  const global = chroma(mean);
  return { grid, mean_luma: meanL, global_chroma: global, cells: cells.map(c => c.n ? { weight: c.n / total,
    luma: c.l / c.n, rel_luma: c.l / c.n / (meanL + 1e-4), chroma_offset: chroma(c.rgb.map(v => v / c.n)).map((v, k) => v - global[k]) } : { weight: 0 }) };
}
function regionLosses(a, b) {
  if (!a || !b) return { tone_structure: 1, exposure: 1, colour_variation: 1, global_tint: 1 };
  let structure = 0, colour = 0, weight = 0;
  a.cells.forEach((p, i) => {
    const q = b.cells[i]; if (!p.weight || !q.weight) return;
    const w = Math.min(p.weight, q.weight); weight += w;
    structure += w * rho(Math.abs(Math.log((q.rel_luma + 0.02) / (p.rel_luma + 0.02))) / 0.35);
    colour += w * rho(Math.hypot(q.chroma_offset[0] - p.chroma_offset[0], q.chroma_offset[1] - p.chroma_offset[1]) / 0.03);
  });
  return { tone_structure: weight ? structure / weight : 1, colour_variation: weight ? colour / weight : 1,
    exposure: rho(Math.abs(Math.log((b.mean_luma + 0.02) / (a.mean_luma + 0.02))) / 0.4),
    global_tint: rho(Math.hypot(b.global_chroma[0] - a.global_chroma[0], b.global_chroma[1] - a.global_chroma[1]) / 0.03) };
}

// Multiscale mean-luma maps (coarse to fine). Smooth where the highlight terms saturate, so a candidate far from the reference
// still has a usable direction; compared with an RMSE through a bounded loss.
function luminanceScales(img, mask = null) {
  return SCALES.map(g => {
    const sums = new Float64Array(g * g), counts = new Float64Array(g * g);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const i = y * img.w + x; if (mask && !mask[i]) continue;
      const cell = Math.min(g - 1, (y * g / img.h) | 0) * g + Math.min(g - 1, (x * g / img.w) | 0);
      sums[cell] += lumaAt(img, i); counts[cell]++;
    }
    return { grid: g, means: Array.from(sums, (s, k) => counts[k] ? s / counts[k] : null) };
  });
}
function multiscaleLoss(a, b) {
  if (!a || !b) return 1;
  let total = 0;
  for (let s = 0; s < a.length; s++) {
    let sq = 0, n = 0;
    a[s].means.forEach((m, k) => { const o = b[s].means[k]; if (m != null && o != null) { sq += (m - o) ** 2; n++; } });
    total += n ? rho(Math.sqrt(sq / n) / 0.08) : 1;
  }
  return total / a.length;
}

// ---- sharpness --------------------------------------------------------------------------------------------------
function edgeSharpness(img, mask = null) {
  const { l, idx } = lumaImage(img, mask);
  const mags = [];
  for (const i of idx) {
    const x = i % img.w, y = (i / img.w) | 0;
    if (x < 1 || y < 1 || x > img.w - 2 || y > img.h - 2) continue;
    mags.push(Math.hypot((l[i + 1] - l[i - 1]) / 2, (l[i + img.w] - l[i - img.w]) / 2));
  }
  if (!mags.length) return 0;
  mags.sort((a, b) => a - b);
  // Edge strength relative to the region's contrast, so dimming or brightening alone does not look like blur.
  const sorted = idx.map(i => l[i]).sort((a, b) => a - b);
  return quantile(mags, 0.97) / (quantile(sorted, 0.95) - quantile(sorted, 0.05) + 0.03);
}

// ---- combined ---------------------------------------------------------------------------------------------------
function describe(img, mask = null, options = {}) {
  assertImage(img, 'image');
  if (mask && mask.length !== img.w * img.h) throw new Error('The mask does not match the image.');
  return { highlights: highlightBlobs(img, mask, options), shadow: shadowDescriptor(img, mask), regions: regionGrid(img, mask, options.grid || GRID), scales: luminanceScales(img, mask), sharpness: edgeSharpness(img, mask) };
}
function compare(reference, render, weights = {}) {
  const w = { ...WEIGHTS, ...weights };
  const highlight = highlightLoss(reference.highlights, render.highlights), regional = regionLosses(reference.regions, render.regions);
  const components = { highlights: highlight.loss, shadow: shadowLoss(reference.shadow, render.shadow), ...regional, multiscale_tone: multiscaleLoss(reference.scales, render.scales),
    sharpness: rho(Math.abs(Math.log((render.sharpness + 0.002) / (reference.sharpness + 0.002))) / 0.35) };
  const sum = Object.keys(components).reduce((n, k) => n + (w[k] || 0), 0);
  const total = sum > 0 ? Object.keys(components).reduce((n, k) => n + (w[k] || 0) * components[k], 0) / sum : NaN;
  return { total, components, weights: w,
    diagnostics: { highlight_counts: { reference: highlight.reference_count, render: highlight.render_count, matched: highlight.matched },
      global_tint_shift_suspected: regional.global_tint > 0.25, note: 'Lower is better. Not a similarity percentage; comparable only for one reference, mask and renderer.' } };
}
// Convenience: score a render against a reference (both display-space images) inside an optional shared mask.
function score(reference, render, { mask = null, weights = {}, referenceDescription = null } = {}) {
  assertImage(reference, 'reference'); assertImage(render, 'render');
  if (reference.w !== render.w || reference.h !== render.h) throw new Error('Reference and render must be compared at the same size.');
  return compare(referenceDescription || describe(reference, mask), describe(render, mask), weights);
}

module.exports = { WEIGHTS, fromPng, describe, compare, score, highlightBlobs, highlightLoss, shadowDescriptor, shadowLoss, regionGrid, regionLosses, edgeSharpness, rho };
