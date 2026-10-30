// Explicit photographic objectives. These are display-image heuristics, not physical reconstruction.
const { decode } = require('./png');
const { normalizeMask, forEachMasked, maskedStatistics } = require('./image-mask');
const { SPACES, lumaOf } = require('./colour-contract');
const { powerMode } = require('./light-spec');
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
  const reference_region = input.reference_region == null ? null : region(input.reference_region);
  // One mask is applied to the reference AND the render. With a reference region and no explicit mask the shared mask is the
  // whole rectangle, so the photograph is no longer scored on every pixel while the render is scored on a Clown product mask.
  const mask = input.mask == null ? (reference_region ? normalizeMask({ kind: 'rect' }) : null) : normalizeMask(input.mask);
  if (mask && !reference_region) throw new Error('A measurement mask needs a reference region to define its coordinates.');
  return { objective, reference_region, mask, power_mode: powerMode(input.power_mode),
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
// Display-space statistics of the reference inside the shared mask. Coordinates are relative to the rectangle.
function referenceMetrics(buffer, rect, maskInput = null) {
  const r = region(rect), mask = maskInput == null ? null : normalizeMask(maskInput), img = decode(buffer), samples = [];
  if (mask?.exclude_transparent && !img.hasAlpha) throw new Error('Excluding transparent areas needs a reference image with an alpha channel.');
  const step = Math.max(1, Math.floor(Math.max(img.w, img.h) / 640));
  forEachMasked(mask, r, img.w, img.h, step, (x, y, u, v) => {
    if (mask?.exclude_transparent && img.alpha(x, y) < 128) return;
    const rgb = img.px(x, y).map(c => c / 255);
    samples.push({ u, v, l: lumaOf(rgb[0], rgb[1], rgb[2]), rgb });
  });
  if (!samples.length) throw new Error('The reference region contains no pixels.');
  const stats = maskedStatistics(samples);
  return { p05_luma: stats.p05_luma, p50_luma: stats.p50_luma, p95_luma: stats.p95_luma, mean_luma: stats.mean_luma, highlight: stats.highlight, mean_rgb: stats.mean_rgb,
    sampled_pixels: stats.sampled_pixels, colour_space: SPACES.DISPLAY, ...(mask ? { mask_signature: mask.signature } : {}) };
}
function maskedObjectiveScore(evidence, target, objective) {
  const m = evidence?.masked_beauty;
  // Fail closed unless both sides were measured with the same mask in the same colour space.
  if (!evidence?.available || !m || m.mask_signature !== target.mask_signature || m.colour_space !== target.colour_space
      || evidence.measurement_scope?.kind !== 'projected_bounds_roi') return null;
  if (objective === 'tone') return Number.isFinite(m.p95_luma) ? Math.abs(m.p95_luma - target.p95_luma) : null;
  if (objective === 'contrast') return [m.p95_luma, m.p05_luma].every(Number.isFinite)
    ? Math.abs((m.p95_luma - m.p05_luma) - (target.p95_luma - target.p05_luma)) : null;
  if (!target.highlight || !m.highlight) return null;
  const result = Math.hypot(m.highlight.x - target.highlight.x, m.highlight.y - target.highlight.y);
  return Number.isFinite(result) ? result : null;
}
function objectiveScore(evidence, target, objective) {
  if (target?.mask_signature) return maskedObjectiveScore(evidence, target, objective);
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
  copy.power_mode = baseline.power_mode || 'artistic';   // the power model is part of the recipe and never changes mid-search
  if (locks.environment) copy.environment = JSON.parse(JSON.stringify(baseline.environment));
  const groups = { position: ['az', 'el', 'd', 'roll', 'target_offset'], power: ['gain', 'multiplier', 'E', 'ies_intensity_source'], color: ['rgb', 'kelvin'],
    shape: ['w', 'h', 'radius', 'angle', 'falloff', 'constant_output', 'visibility', 'refl', 'eye', 'shadows'] };
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
