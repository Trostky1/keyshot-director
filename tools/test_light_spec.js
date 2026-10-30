// Stage A (research E03): IES gain/multiplier trace, physical vs artistic power, per-light aim and visibility intent.
// Offline: pure functions and source-level reads of the bridge. No KeyShot scene is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { cleanPlan } = require('../server/photo');
const { lockedPlan, settings } = require('../server/photo-refinement');
const { describeLight, lightSpec, iesDimmer, POWER_MODES, PHYSICAL_REFERENCE_DISTANCE_SPANS } = require('../server/light-spec');

const subject = { center: [0, 100, 0], size: [100, 200, 50], span: 200 };
const IES = 'Light/IES Light/Test/Profile.ies';
const state = { subject, frameAz: 0, exposure: 1 };
const iesLight = extra => cleanPlan({ lights: [{ type: 'ies', ies_asset_id: IES, ...extra }] }).lights[0];
const areaLight = extra => cleanPlan({ lights: [{ type: 'area', ...extra }] }).lights[0];

test('IES gain-only plan reaches the native multiplier (E03 source trace)', () => {
  const l = iesLight({ gain: 3 });
  assert.equal(l.multiplier, 3); assert.equal(l.gain, 3); assert.equal(l.ies_intensity_source, 'gain');
  assert.equal(lightSpec(l, {}, state).multiplier, 3);
});
test('IES multiplier-only plan is honored and mirrored into gain', () => {
  const l = iesLight({ multiplier: 40 });
  assert.equal(l.multiplier, 40); assert.equal(l.ies_intensity_source, 'multiplier');
  assert.equal(lightSpec(l, {}, state).multiplier, 40);
});
test('IES with neither field is neutral, and gain wins over a stale multiplier', () => {
  assert.equal(iesLight({}).multiplier, 1); assert.equal(iesLight({}).ies_intensity_source, 'default');
  const both = iesLight({ gain: 2.5, multiplier: 9 });
  assert.equal(both.multiplier, 2.5); assert.equal(lightSpec(both, {}, state).multiplier, 2.5);
});
test('a defaulted multiplier of 1 no longer shadows the planner gain (the pre-fix behavior)', () => {
  // Before the fix cleanPlan emitted multiplier: 1 for every light, and lightSpec preferred a finite multiplier over gain.
  const legacy = { ...iesLight({ gain: 5 }), multiplier: 1 };
  assert.equal(lightSpec(legacy, {}, state).multiplier, 1, 'documents the old failure mode: gain 5 would have been ignored');
  assert.equal(lightSpec(iesLight({ gain: 5 }), {}, state).multiplier, 5);
});
test('the bridge consumes only spec.multiplier for IES intensity and never sees gain', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'cc_lights.py'), 'utf8');
  const fn = source.slice(source.indexOf('def _set_params'), source.indexOf('def _capture_light_parameters'));
  assert.match(fn, /light_type != "ies" and "power" in spec/, 'power is not written for IES lights');
  assert.match(fn, /elif light_type == "ies":\s+if "multiplier" in spec: want\["multiplier"\] = float\(spec\["multiplier"\]\)/);
  assert.doesNotMatch(fn, /\bgain\b/, 'gain is a planner field and is not a bridge parameter');
  const spec = lightSpec(iesLight({ gain: 2 }), {}, state);
  assert.ok(!('gain' in spec) && !('power' in spec) && spec.multiplier === 2);
});

test('artistic mode keeps the historical distance-squared normalization and rig exposure', () => {
  const near = areaLight({ d: 2, gain: 1.5 }), far = { ...near, d: 4 };
  const dist = d => d * subject.span;
  const legacy = (l, exposure) => +(l.E * (l.gain ?? 1) * dist(l.d) ** 2 * exposure).toFixed(2);
  assert.equal(lightSpec(near, {}, state).power, legacy(near, 1));
  assert.equal(lightSpec(far, {}, { ...state, exposure: 1.7 }).power, legacy(far, 1.7));
  assert.ok(Math.abs(lightSpec(far, {}, state).power / lightSpec(near, {}, state).power - 4) < 1e-3);
});
test('physical mode holds flux fixed: distance and rig exposure no longer change it', () => {
  const near = areaLight({ d: 2, gain: 1.5 }), far = { ...near, d: 6 };
  const a = describeLight(near, { powerMode: 'physical' }, { ...state, exposure: 1 });
  const b = describeLight(far, { powerMode: 'physical' }, { ...state, exposure: 3 });
  assert.equal(a.spec.power, b.spec.power);
  const reference = PHYSICAL_REFERENCE_DISTANCE_SPANS * subject.span;
  assert.equal(a.spec.power, +(near.E * 1.5 * reference * reference).toFixed(2));
  assert.deepEqual([a.power.mode, a.power.distance_coupled, a.power.exposure_applied, a.power.quantity], ['physical', false, false, 'flux_lm']);
  assert.notDeepEqual(a.spec.pos, b.spec.pos, 'geometry still moves');
});
test('source scale (detail framing) still scales physical flux with the visible product area', () => {
  const l = areaLight({});
  const full = describeLight(l, { powerMode: 'physical', sourceScale: 1 }, state).spec.power;
  const detail = describeLight(l, { powerMode: 'physical', sourceScale: 0.5 }, state).spec.power;
  assert.ok(Math.abs(detail / full - 0.25) < 1e-3);
});
test('IES physical mode ignores rig exposure; artistic multiplies it', () => {
  const l = iesLight({ gain: 2 });
  assert.equal(lightSpec(l, { powerMode: 'artistic' }, { ...state, exposure: 1.5 }).multiplier, 3);
  const detail = describeLight(l, { powerMode: 'physical' }, { ...state, exposure: 1.5 });
  assert.equal(detail.spec.multiplier, 2); assert.equal(detail.power.exposure_applied, false);
});
test('power mode defaults to artistic, is validated, and is stored in the plan and settings', () => {
  assert.deepEqual(POWER_MODES, ['artistic', 'physical']);
  assert.equal(cleanPlan({ lights: [{}] }).power_mode, 'artistic');
  assert.equal(cleanPlan({ lights: [{}], power_mode: 'physical' }).power_mode, 'physical');
  assert.equal(cleanPlan({ lights: [{}], power_mode: 'lumens-please' }).power_mode, 'artistic');
  assert.equal(settings({}).power_mode, 'artistic'); assert.equal(settings({ power_mode: 'physical' }).power_mode, 'physical');
});
test('a refinement candidate can never change the baseline power mode', () => {
  const baseline = cleanPlan({ lights: [{}], power_mode: 'physical' });
  const candidate = cleanPlan({ lights: [{}], power_mode: 'artistic' });
  assert.equal(lockedPlan(candidate, baseline, {}).power_mode, 'physical');
});
test('iesDimmer clamps and reports its source', () => {
  assert.deepEqual(iesDimmer({ gain: 1000 }), { value: 15, source: 'gain' });
  assert.deepEqual(iesDimmer({ multiplier: 0 }), { value: 0.001, source: 'multiplier' });
  assert.deepEqual(iesDimmer({ gain: NaN, multiplier: Infinity }), { value: 1, source: 'default' });
});

test('per-light aim offsets move only the target, scale with the span and are bounded', () => {
  const shared = [10, 20, 30], l = areaLight({ target_offset: [0.5, -0.25, 0] });
  const spec = lightSpec(l, { target: shared }, state);
  assert.deepEqual(spec.target, [10 + 0.5 * 200, 20 - 0.25 * 200, 30]);
  const plain = lightSpec(areaLight({}), { target: shared }, state);
  assert.deepEqual(plain.target, shared);
  assert.deepEqual(lightSpec(l, { target: shared }, state).pos, lightSpec({ ...l, target_offset: undefined }, { target: shared }, state).pos);
  assert.deepEqual(areaLight({ target_offset: [9, -9, 0.1] }).target_offset, [0.75, -0.75, 0.1]);
  for (const bad of [[1, 2], 'x', [0, 0, NaN], null]) assert.equal(areaLight({ target_offset: bad }).target_offset, undefined);
});
test('two lights can aim at different points', () => {
  const plan = cleanPlan({ lights: [{ target_offset: [0.3, 0, 0] }, { target_offset: [-0.3, 0, 0] }] });
  const [a, b] = plan.lights.map(l => lightSpec(l, { target: [0, 0, 0] }, state));
  assert.notDeepEqual(a.target, b.target);
});
test('visibility intent is explicit for Area sources and reported, not silently dropped, for other types', () => {
  const area = areaLight({ visibility: { camera: true, reflection: false, shadows: false } });
  assert.deepEqual([area.eye, area.refl, area.shadows, area.visibility.applies], [true, false, false, true]);
  const spec = lightSpec(area, {}, state);
  assert.deepEqual([spec.visible_eye, spec.visible_refl, spec.visible_shadows], [true, false, false]);
  const defaults = areaLight({}); assert.deepEqual([defaults.eye, defaults.refl], [false, true]); assert.equal(defaults.shadows, undefined);
  const plan = cleanPlan({ lights: [{ type: 'point', visibility: { camera: true } }, { type: 'spotlight' }] });
  assert.equal(plan.lights[0].eye, false); assert.equal(plan.lights[0].visibility.applies, false);
  assert.match(plan.limitations.join(' '), /Light 1 \(point\) cannot change emitter visibility/);
  assert.equal(plan.lights[1].visibility.applies, false); assert.equal(plan.limitations.length, 1);
  assert.equal(areaLight({ visibility: { camera: 'yes' } }).eye, false, 'non-boolean intent falls back to the default');
});
test('locks protect the new aim and visibility fields with their groups', () => {
  const baseline = cleanPlan({ lights: [{ target_offset: [0.1, 0, 0], visibility: { camera: true } }] });
  const candidate = cleanPlan({ lights: [{ target_offset: [-0.4, 0, 0], visibility: { camera: false } }] });
  const moved = lockedPlan(candidate, baseline, { position: true, shape: true }).lights[0];
  assert.deepEqual(moved.target_offset, [0.1, 0, 0]); assert.equal(moved.eye, true); assert.equal(moved.visibility.camera, true);
  const free = lockedPlan(candidate, baseline, {}).lights[0];
  assert.deepEqual(free.target_offset, [-0.4, 0, 0]);
});
