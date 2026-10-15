// Explicit photographic objectives. These are display-image heuristics, not physical reconstruction.
const { decode } = require('./png');
const OBJECTIVES = ['highlight_position', 'contrast', 'tone'];
function region(value) {
  if (!value || !['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1)
      || value.x1 - value.x0 < 0.025 || value.y1 - value.y0 < 0.025) throw new Error('Choose a reference region at least 2.5% wide and high, within the image.');
  return Object.fromEntries(['x0', 'y0', 'x1', 'y1'].map(k => [k, value[k]]));
}
function settings(input = {}) {
  const objective = input.objective || 'highlight_position';
  if (!OBJECTIVES.includes(objective)) throw new Error('Unknown lighting objective.');
  const integer = (v, d, lo, hi) => { if (v == null) return d; if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Refinement budget must be an integer from ${lo} to ${hi}.`); return v; };
  return { objective, reference_region: input.reference_region == null ? null : region(input.reference_region),
    max_attempts: integer(input.max_attempts, 2, 1, 3), max_captures: integer(input.max_captures, 12, 6, 16),
    max_seconds: integer(input.max_seconds, 480, 30, 900),
    locks: { position: input.locks?.position === true, power: input.locks?.power === true, color: input.locks?.color === true,
      environment: input.locks?.environment === true, shape: input.locks?.shape === true } };
}
function dimensions(aspect, maxSide = 640) {
  if (!Number.isFinite(aspect) || aspect < 0.05 || aspect > 20) throw new Error('Reference aspect ratio must be between 1:20 and 20:1.');
  const width = Math.max(32, Math.round(Math.min(maxSide, maxSide * aspect) / 2) * 2);
  const height = Math.max(32, Math.round(Math.min(maxSide, maxSide / aspect) / 2) * 2);
  return { width, height };
}
function referenceMetrics(buffer, rect) {
  const r = region(rect), img = decode(buffer), samples = [];
  const step = Math.max(1, Math.floor(Math.max(img.w, img.h) / 640));
  for (let y = Math.ceil(r.y0 * img.h); y < r.y1 * img.h; y += step)
    for (let x = Math.ceil(r.x0 * img.w); x < r.x1 * img.w; x += step) {
      const rgb = img.px(x, y); samples.push({ x: (x / img.w - r.x0) / (r.x1 - r.x0), y: (y / img.h - r.y0) / (r.y1 - r.y0),
        l: (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255 });
    }
  const sorted = samples.map(p => p.l).sort((a, b) => a - b), q = f => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  if (!samples.length) throw new Error('The reference region contains no pixels.');
  const bright = samples.filter(p => p.l >= q(0.9));
  return { p05_luma: q(0.05), p95_luma: q(0.95), highlight: q(0.95) - q(0.05) < 0.02 ? null : {
    x: bright.reduce((n, p) => n + p.x, 0) / bright.length, y: bright.reduce((n, p) => n + p.y, 0) / bright.length } };
}
function objectiveScore(evidence, target, objective) {
  const p = evidence?.beauty_product, b = evidence?.product_mask?.bounds_normalized;
  if (!evidence?.available || !p || !b || !target || evidence.measurement_scope?.kind !== 'projected_bounds_roi') return null;
  if (objective === 'tone') return Number.isFinite(p.p95_luma) ? Math.abs(p.p95_luma - target.p95_luma) : null;
  if (objective === 'contrast') return [p.p95_luma, p.p05_luma].every(Number.isFinite)
    ? Math.abs((p.p95_luma - p.p05_luma) - (target.p95_luma - target.p05_luma)) : null;
  const h = p.highlight_centroid_normalized;
  if (!target.highlight || !h || p.p95_luma - p.p05_luma < 0.02 || b.x1 <= b.x0 || b.y1 <= b.y0) return null;
  const result = Math.hypot((h.x - b.x0) / (b.x1 - b.x0) - target.highlight.x, (h.y - b.y0) / (b.y1 - b.y0) - target.highlight.y);
  return Number.isFinite(result) ? result : null;
}
function decision(best, candidate, repeat, target, objective) {
  const prior = objectiveScore(best, target, objective), next = objectiveScore(candidate, target, objective), noiseScore = objectiveScore(repeat, target, objective);
  const comparison = candidate?.comparison_to;
  if (![prior, next, noiseScore].every(Number.isFinite)) return { accepted: false, reason: 'Objective or repeat-noise measurements unavailable.' };
  if (!comparison?.available || !comparison.mask_agreement?.suitable_for_lighting_only_comparison)
    return { accepted: false, reason: 'Capture state or measured region changed; comparison is unsuitable.' };
  const margin = Math.max(0.005, 2 * Math.abs(noiseScore - prior));
  const accepted = prior - next > margin;
  return { accepted, reason: accepted ? 'Objective improved beyond the measured repeat variation.' : 'No improvement beyond the measured repeat variation; restored the best look.',
    objective, previous_error: prior, candidate_error: next, required_improvement: margin };
}
function lockedPlan(candidate, baseline, locks) {
  // Retain source identity/count and camera intent throughout a lighting search.
  const copy = JSON.parse(JSON.stringify(candidate));
  copy.shot = JSON.parse(JSON.stringify(baseline.shot));
  if (locks.environment) copy.environment = JSON.parse(JSON.stringify(baseline.environment));
  const groups = { position: ['az', 'el', 'd', 'roll'], power: ['gain', 'multiplier', 'E'], color: ['rgb', 'kelvin'], shape: ['w', 'h', 'radius', 'angle', 'falloff', 'constant_output'] };
  copy.lights = baseline.lights.map((source, i) => {
    const light = { ...(copy.lights[i] || source), id: source.id, type: source.type };
    if (source.type === 'ies') light.ies_asset_id = source.ies_asset_id;
    for (const [group, keys] of Object.entries(groups)) if (locks[group]) for (const k of keys) {
      if (Object.hasOwn(source, k)) light[k] = source[k]; else delete light[k];
    }
    return light;
  });
  return copy;
}
module.exports = { OBJECTIVES, settings, region, dimensions, referenceMetrics, objectiveScore, decision, lockedPlan };
