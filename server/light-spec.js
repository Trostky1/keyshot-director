// Pure stage-frame light -> bridge spec conversion, with an explicit power model.
// Extracted from server.js so the power normalization can be tested and recorded in every recipe.
const { toPos } = require('./rigs');

const TYPES = ['area', 'point', 'ies', 'spotlight'];
// 'artistic' (the historical behavior): non-IES flux = E * gain * distance^2 * rig exposure, so moving a light along its
//   axis keeps the illuminance at the product roughly constant and the rig exposure multiplies every light.
// 'physical': flux is held fixed. It depends on E, gain and the framing scale only, never on distance or rig exposure,
//   so a distance change is a pure geometry change and an optimizer can treat flux and position independently.
const POWER_MODES = ['artistic', 'physical'];
const DEFAULT_POWER_MODE = 'artistic';
// Nominal distance (in product spans) at which E * gain is interpreted as illuminance in physical mode.
const PHYSICAL_REFERENCE_DISTANCE_SPANS = 3;

const powerMode = v => POWER_MODES.includes(v) ? v : DEFAULT_POWER_MODE;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const clampNumber = (v, lo, hi, d) => finite(v) ? Math.min(hi, Math.max(lo, v)) : d;

// IES intensity has ONE native control (the profile multiplier). The planner calls it `gain` (a dimmer); lower-level
// edits call it `multiplier`. Resolve both into one value and say where it came from. `gain` wins when both are
// supplied because it is the documented planner field and the only one a refinement prompt tells the model to change.
function iesDimmer(l) {
  if (finite(l?.gain)) return { value: clampNumber(l.gain, 0.02, 15, 1), source: 'gain' };
  if (finite(l?.multiplier)) return { value: clampNumber(l.multiplier, 0.001, 1000000, 1), source: 'multiplier' };
  return { value: 1, source: 'default' };
}

// Aim point for one light: the shared target plus an optional per-light offset given in product spans.
function aimPoint(base, offset, span) {
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(finite)) return base.slice(0, 3);
  return base.map((v, i) => v + offset[i] * span);
}

// state: { subject, frameAz, exposure }. context: { subject, target, sourceScale, powerMode }.
function describeLight(l, context = {}, state = {}) {
  const s = context.subject || state.subject;
  if (!s) throw new Error('No product bounds are available for lighting.');
  const base = Array.isArray(context.target) ? context.target : s.center;
  const scale = Number.isFinite(context.sourceScale) ? context.sourceScale : 1;
  const exposure = Number.isFinite(state.exposure) ? state.exposure : 1;
  const mode = powerMode(context.powerMode ?? l.power_mode ?? state.powerMode);
  const d = l.d * scale, dist = d * s.span;
  const type = TYPES.includes(l.type) ? l.type : 'area';
  const target = aimPoint(base, l.target_offset, s.span);
  const spec = {
    id: l.id, type, pos: toPos(base, state.frameAz || 0, { ...l, d }, s.span), target,
    size: [l.w * scale * s.span, l.h * scale * s.span],
    ...(type !== 'ies' || Number.isFinite(l.kelvin) ? { kelvin: l.kelvin } : {}),
    ...(Array.isArray(l.rgb) ? { rgb: l.rgb } : {}),
    radius: Number.isFinite(l.radius) ? l.radius : 0,
    angle: Number.isFinite(l.angle) ? l.angle : 45,
    falloff: Number.isFinite(l.falloff) ? l.falloff : 0.5,
    constant_output: l.constant_output !== false,
    roll: l.roll || 0, visible_refl: l.refl, visible_eye: l.eye, visible_shadows: l.shadows ?? true,
  };
  let power;
  if (type === 'ies') {
    // A finite explicit multiplier is authoritative at the spec level (restored/edited lights carry one); cleanPlan folds
    // the planner's gain into it. Rig exposure is part of the artistic model only.
    const dimmer = finite(l.multiplier) ? l.multiplier : (l.gain ?? 1);
    const applied = mode === 'physical' ? dimmer : dimmer * exposure;
    spec.multiplier = +applied.toFixed(4);
    spec.ies_asset_id = l.ies_asset_id;
    if (Number.isInteger(l.axis)) spec.axis = l.axis;
    power = { mode, quantity: 'ies_multiplier', value: spec.multiplier, exposure_applied: mode !== 'physical',
      distance_coupled: false, model: mode === 'physical' ? 'multiplier = dimmer' : 'multiplier = dimmer * rig exposure' };
  } else if (mode === 'physical') {
    const reference = PHYSICAL_REFERENCE_DISTANCE_SPANS * scale * s.span;
    spec.power = +(l.E * (l.gain ?? 1) * reference * reference).toFixed(2);
    power = { mode, quantity: 'flux_lm', value: spec.power, exposure_applied: false, distance_coupled: false,
      reference_distance_mm: +reference.toFixed(3), model: 'flux = E * gain * (reference distance)^2' };
  } else {
    spec.power = +(l.E * (l.gain ?? 1) * dist * dist * exposure).toFixed(2);
    power = { mode, quantity: 'flux_lm', value: spec.power, exposure_applied: true, distance_coupled: true,
      model: 'flux = E * gain * distance^2 * rig exposure' };
  }
  return { spec, power };
}

const lightSpec = (l, context, state) => describeLight(l, context, state).spec;

module.exports = { TYPES, POWER_MODES, DEFAULT_POWER_MODE, PHYSICAL_REFERENCE_DISTANCE_SPANS, powerMode, iesDimmer, aimPoint, describeLight, lightSpec };
