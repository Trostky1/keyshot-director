// style.js - "styles" are folders of reference images. We measure each image (backdrop, tone, contrast, highlight
// placement, colour cast, composition), group them into looks, and keep a profile per look. A live KeyShot frame can then
// be scored against a profile and the per-feature differences say what to change.
const fs = require('fs');
const path = require('path');
const { decode } = require('./png');
const { normalizeFolder: normalizeImageFolder } = require('./image-tools');

const ROOT = path.join(__dirname, '..', 'references');
const IMG = /\.(jpe?g|png|bmp|tiff?|gif|webp|avif|heic|heif|jxl)$/i;

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;

function features(img, { mask: objectMask, region } = {}) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w < 1 || img.h < 1 || typeof img.px !== 'function')
    throw new Error('Style measurement needs a nonempty decoded image.');
  if (objectMask && (objectMask.w !== img.w || objectMask.h !== img.h)) throw new Error('Style mask dimensions do not match the beauty capture.');
  if (region && (!objectMask || !['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(region[k]) && region[k] >= 0 && region[k] <= 1) ||
      region.x0 >= region.x1 || region.y0 >= region.y1)) throw new Error('Style region needs an aligned object mask and valid normalized bounds.');
  // sample on a grid (<= ~120k points)
  const step = Math.max(1, Math.round(Math.sqrt((img.w * img.h) / 120000)));
  const pts = [];
  for (let y = 0; y < img.h; y += step) for (let x = 0; x < img.w; x += step) { const [r, g, b] = img.px(x, y); pts.push({ x: (x + 0.5) / img.w, y: (y + 0.5) / img.h, pixelX: x, pixelY: y, r, g, b, l: lum(r, g, b) }); }
  // backdrop from the frame border; "has backdrop" when the four corners agree
  const corner = (x0, y0) => pts.filter(p => p.x >= x0 && p.x < x0 + 0.1 && p.y >= y0 && p.y < y0 + 0.1);
  const cs = [corner(0, 0), corner(0.9, 0), corner(0, 0.9), corner(0.9, 0.9)].map(c => ({ l: med(c.map(p => p.l)), r: med(c.map(p => p.r)), g: med(c.map(p => p.g)), b: med(c.map(p => p.b)) }));
  const cl = cs.map(c => c.l), spread = Math.max(...cl) - Math.min(...cl);
  const bgL = med(cl), bgRGB = ['r', 'g', 'b'].map(k => Math.round(med(cs.map(c => c[k]))));
  // product mask: pixels that differ from the backdrop; when the product fills the frame there is no usable backdrop
  const tol = 0.06;
  let mask = pts.filter(p => Math.abs(p.l - bgL) > tol || Math.hypot(p.r - bgRGB[0], p.g - bgRGB[1], p.b - bgRGB[2]) / 255 > 0.14);
  const hasBackdrop = spread < 0.18 && mask.length < 0.85 * pts.length;
  if (objectMask) {
    mask = pts.filter(p => (!region || (p.x >= region.x0 && p.x < region.x1 && p.y >= region.y0 && p.y < region.y1))
      && Math.max(...objectMask.px(p.pixelX, p.pixelY).slice(0, 3)) > 8);
    if (!mask.length) throw new Error('No labelled target pixels in the style measurement region.');
  } else if (!hasBackdrop || mask.length < 0.05 * pts.length) mask = pts;
  const L = mask.map(p => p.l).sort((a, b) => a - b);
  const xs = mask.map(p => p.x).sort((a, b) => a - b), ys = mask.map(p => p.y).sort((a, b) => a - b);
  const bb = { x0: pct(xs, 0.01), x1: pct(xs, 0.99), y0: pct(ys, 0.01), y1: pct(ys, 0.99) };
  const bw = Math.max(0.01, bb.x1 - bb.x0), bh = Math.max(0.01, bb.y1 - bb.y0);
  const hi = mask.filter(p => p.l >= pct(L, 0.97));
  const hi10 = mask.filter(p => p.l >= pct(L, 0.9));
  const warm = a => a.length ? a.reduce((s, p) => s + (p.r - p.b) / (p.r + p.b + 1), 0) / a.length : 0;
  const sat = mask.reduce((s, p) => { const mx = Math.max(p.r, p.g, p.b), mn = Math.min(p.r, p.g, p.b); return s + (mx ? (mx - mn) / mx : 0); }, 0) / mask.length;
  const third = (a, lo, hi2, axis) => { const v = a.filter(p => ((axis === 'x' ? (p.x - bb.x0) / bw : (p.y - bb.y0) / bh) >= lo) && ((axis === 'x' ? (p.x - bb.x0) / bw : (p.y - bb.y0) / bh) < hi2)); return v.length ? v.reduce((s, p) => s + p.l, 0) / v.length : 0; };
  const lft = third(mask, 0, 1 / 3, 'x'), rgt = third(mask, 2 / 3, 1.01, 'x'), top = third(mask, 0, 1 / 3, 'y'), bot = third(mask, 2 / 3, 1.01, 'y');
  const ring = mask.filter(p => { const u = (p.x - bb.x0) / bw, v = (p.y - bb.y0) / bh; return u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92; });
  const inner = mask.filter(p => { const u = (p.x - bb.x0) / bw, v = (p.y - bb.y0) / bh; return u > 0.2 && u < 0.8 && v > 0.2 && v < 0.8; });
  const mean = a => a.length ? a.reduce((s, p) => s + p.l, 0) / a.length : 0;
  // backdrop gradient: brightness of the backdrop near the top vs bottom of the frame (a floor/wall light falloff)
  const bgPts = hasBackdrop ? pts.filter(p => Math.abs(p.l - bgL) <= tol && (p.x < 0.12 || p.x > 0.88)) : [];
  const bgTop = mean(bgPts.filter(p => p.y < 0.4)), bgBot = mean(bgPts.filter(p => p.y > 0.6));
  return {
    measurement_scope: objectMask ? (region ? 'Clown labels within projected bounds; may include occluders and unrelated geometry.' : 'All non-black Clown labels; semantic product identity is unverified.')
      : 'Reference border-color heuristic; segmentation is uncertain.',
    hasBackdrop: hasBackdrop ? 1 : 0,
    bgLuma: +bgL.toFixed(3), bgRGB, bgGradient: hasBackdrop && bgPts.length > 20 ? +(bgTop - bgBot).toFixed(3) : 0,
    p05: +pct(L, 0.05).toFixed(3), p25: +pct(L, 0.25).toFixed(3), p50: +pct(L, 0.5).toFixed(3), p75: +pct(L, 0.75).toFixed(3), p95: +pct(L, 0.95).toFixed(3), p99: +pct(L, 0.99).toFixed(3),
    clip: +(mask.filter(p => p.l > 0.97).length / mask.length).toFixed(4), crush: +(mask.filter(p => p.l < 0.04).length / mask.length).toFixed(4),
    contrast: +Math.log2((pct(L, 0.95) + 0.03) / (pct(L, 0.25) + 0.03)).toFixed(3),
    saturation: +sat.toFixed(3), warmth: +warm(mask).toFixed(3), highlightWarmth: +warm(hi10).toFixed(3),
    highlightX: hi.length ? +(((hi.reduce((s, p) => s + p.x, 0) / hi.length) - (bb.x0 + bb.x1) / 2) / (bw / 2)).toFixed(3) : 0,
    highlightY: hi.length ? +(((hi.reduce((s, p) => s + p.y, 0) / hi.length) - (bb.y0 + bb.y1) / 2) / (bh / 2)).toFixed(3) : 0,
    sideBias: +((lft - rgt) / (lft + rgt + 0.01)).toFixed(3), topBias: +((top - bot) / (top + bot + 0.01)).toFixed(3),
    edgeGlow: +(mean(ring) / Math.max(0.02, mean(inner))).toFixed(3),
    productShare: +(bw * bh).toFixed(3), aspect: +(img.w / img.h).toFixed(3),
    box: [bb.x0, bb.y0, bb.x1, bb.y1].map(v => +v.toFixed(4)),      // product bounding box, fractions of the frame
  };
}

// numeric features used for scoring, with a minimum scale (so a tight cluster does not make everything look "far")
const SCORE = {
  bgLuma: [3, 0.08], p50: [2, 0.08], p95: [2, 0.08], p05: [1, 0.06], contrast: [2.5, 0.4], clip: [1, 0.02], crush: [1, 0.05],
  // saturation / warmth mostly describe the PRODUCT's own colour (an amber perfume is orange under any light), so they
  // barely count; the lighting is judged by tone, contrast, backdrop, highlights and where the light falls.
  saturation: [0.15, 0.08], warmth: [0.2, 0.06], highlightWarmth: [0.3, 0.06], edgeGlow: [1, 0.25], sideBias: [1.5, 0.1], topBias: [1.2, 0.1],
  bgGradient: [1, 0.06], highlightX: [0.8, 0.3], highlightY: [0.8, 0.3],
};

function summarize(feats) {
  const prof = {};
  for (const k of Object.keys(SCORE)) {
    const v = feats.map(f => f[k]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) continue;
    prof[k] = { med: +pct(v, 0.5).toFixed(3), lo: +pct(v, 0.2).toFixed(3), hi: +pct(v, 0.8).toFixed(3), iqr: +(pct(v, 0.75) - pct(v, 0.25)).toFixed(3) };
  }
  return prof;
}

// distance of one feature set from a profile: weighted, normalised by the cluster's own spread (floored). Also returns
// per-feature signed deltas (positive = our frame is higher than the reference) so a caller knows what to change.
function score(f, profile) {
  let total = 0, wsum = 0; const deltas = {};
  for (const [k, [w, floor]] of Object.entries(SCORE)) {
    const p = profile[k]; if (!p || !Number.isFinite(f[k]) || ![p.med, p.lo, p.hi].every(Number.isFinite) || p.lo > p.hi) continue;
    const scale = Math.max(floor, Number.isFinite(p.iqr) && p.iqr >= 0 ? p.iqr : 0);
    const d = (f[k] - p.med) / scale;
    // inside the 20-80% band of the references counts as a match (no penalty)
    const out = f[k] < p.lo ? (p.lo - f[k]) / scale : f[k] > p.hi ? (f[k] - p.hi) / scale : 0;
    total += w * Math.min(out, 6); wsum += w; deltas[k] = { value: f[k], target: p.med, delta: +(f[k] - p.med).toFixed(3), z: +d.toFixed(2), inBand: out === 0 };
  }
  if (!wsum) throw new Error('Style profile has no finite comparable measurements. Analyze its reference images again.');
  return { distance: +(total / wsum).toFixed(3), deltas };
}

async function normalizeFolder(name) {
  const dir = path.join(ROOT, name), cache = path.join(dir, '.cache');
  return normalizeImageFolder(dir, cache, 900);
}

// Split a folder into looks by backdrop brightness (light seamless vs dark), because one profile for both would match neither.
function cluster(items) {
  const dark = items.filter(i => i.f.bgLuma < 0.3 && i.f.hasBackdrop), light = items.filter(i => !(i.f.bgLuma < 0.3 && i.f.hasBackdrop));
  const groups = []; if (light.length) groups.push({ id: 'light', items: light }); if (dark.length) groups.push({ id: 'dark', items: dark });
  return groups;
}

async function analyzeFolder(name) {
  const norm = await normalizeFolder(name);
  const items = [];
  for (const n of norm) {
    if (!n.png) { items.push({ name: n.name, error: n.status }); continue; }
    try { items.push({ name: n.name, f: features(decode(fs.readFileSync(n.png))) }); } catch (e) { items.push({ name: n.name, error: e.message }); }
  }
  const good = items.filter(i => i.f);
  const groups = cluster(good).map(g => ({ id: g.id, images: g.items.map(i => i.name), profile: summarize(g.items.map(i => i.f)) }));
  const res = { style: name, analyzed: good.length, failed: items.filter(i => i.error), looks: groups, images: items.map(i => ({ name: i.name, ...(i.f ? { features: i.f } : { error: i.error }) })), at: new Date().toISOString() };
  fs.writeFileSync(path.join(ROOT, name, 'style_profile.json'), JSON.stringify(res, null, 2));
  return res;
}

function listStyles() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => {
    const dir = path.join(ROOT, d.name), imageFiles = fs.readdirSync(dir).filter(f => IMG.test(f)), n = imageFiles.length;
    let prof = null, fresh = false; try {
      const profilePath = path.join(dir, 'style_profile.json'); prof = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      const profileTime = fs.statSync(profilePath).mtimeMs;
      fresh = !fs.readdirSync(dir).filter(f => IMG.test(f)).some(f => fs.statSync(path.join(dir, f)).mtimeMs > profileTime);
    } catch { /* none yet */ }
    return { name: d.name, images: n, previews: imageFiles.slice(0, 4), analyzed: !!prof && fresh, looks: prof && fresh ? prof.looks.map(l => ({ id: l.id, count: l.images.length })) : [] };
  });
}
function loadProfile(name) { return JSON.parse(fs.readFileSync(path.join(ROOT, name, 'style_profile.json'), 'utf8')); }

module.exports = { features, score, summarize, analyzeFolder, listStyles, loadProfile, normalizeFolder, ROOT };
