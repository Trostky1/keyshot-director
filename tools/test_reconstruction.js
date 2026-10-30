// Stage C (research E07/E09/E13, synthetic-renderer half only): adversarial objective cases, derivative-free search with
// repeat-noise gating and finalist re-validation, the equal-budget comparison harness, and the light-response basis.
// Every result here comes from tools/synthetic_renderer.js. None of it is evidence about KeyShot, real photographs or real vision.
const test = require('node:test');
const assert = require('node:assert/strict');
const objectives = require('../server/lighting-objectives');
const { coordinateSearch, powellSearch, optimize, summarizeRepeats } = require('../server/derivative-free');
const basisFit = require('../server/light-basis');
const synthetic = require('./synthetic_renderer');
const harness = require('./reconstruction_harness');

const lights = (...l) => ({ lights: l.map(([az, el, gain]) => ({ az, el, gain })) });
const REF = lights([-40, 45, 1.0], [60, 10, 0.25]);
const final = (params, scene = {}, seed = 2) => synthetic.render(params, { scene, seed, quality: 'final' });
const score = (reference, render, mask = null) => objectives.score(reference, render, { mask });

// ---- adversarial objective fixtures (plan section 7) ---------------------------------------------------------------
function gradientImage(w, h, fn) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const i = (y * w + x) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b; }
  return { w, h, rgb };
}
const grey = v => [v, v, v];
const blob = (cx, cy, r, peak, base = 0.25) => (x, y) => { const d = Math.hypot(x - cx, y - cy); return grey(d < r ? peak : base); };

test('same highlight centroid, different highlight shape: one central highlight differs from two split ones', () => {
  const one = gradientImage(48, 48, blob(24, 24, 7, 0.95));
  const two = gradientImage(48, 48, (x, y) => grey(Math.hypot(x - 14, y - 24) < 4 && true || Math.hypot(x - 34, y - 24) < 4 ? 0.95 : 0.25));
  const dOne = objectives.highlightBlobs(one).blobs, dTwo = objectives.highlightBlobs(two).blobs;
  assert.equal(dOne.length, 1); assert.equal(dTwo.length, 2);
  const centre = b => b.reduce((n, p) => n + p.centroid.x * p.mass_share, 0);
  assert.ok(Math.abs(centre(dOne) - centre(dTwo)) < 0.03, 'the single bright-pixel centroid cannot tell them apart');
  const s = score(one, two), same = score(one, gradientImage(48, 48, blob(24, 24, 7, 0.95)));
  assert.ok(s.total > same.total + 0.05 && s.components.highlights > 0.3, `${s.components.highlights}`);
  assert.deepEqual(s.diagnostics.highlight_counts, { reference: 1, render: 2, matched: 1 });
});
test('correct overall brightness but the shadow falls on the wrong side', () => {
  const lit = (side) => gradientImage(48, 48, (x, y) => { const inShadow = side === 'right' ? x > 30 && y > 28 && x < 46 : x < 18 && y > 28 && x > 2; return grey(inShadow ? 0.04 : 0.55); });
  const a = lit('right'), b = lit('left');
  const mean = img => img.rgb.reduce((n, v) => n + v, 0) / img.rgb.length;
  assert.ok(Math.abs(mean(a) - mean(b)) < 0.01, 'identical overall brightness');
  const wrong = score(a, b), right = score(a, lit('right'));
  assert.ok(wrong.components.shadow > 0.5 && wrong.total > right.total + 0.05);
  const horizontal = img => Math.cos(objectives.shadowDescriptor(img).angle_deg * Math.PI / 180);
  assert.ok(horizontal(a) > 0.2 && horizontal(b) < -0.2, 'the descriptor points to opposite sides');
});
test('blur lowers the score of an otherwise correct render', () => {
  const sharp = final(REF, {}, 2), reference = final(REF, {}, 3);
  const blurred = (img, passes) => { let cur = img; for (let p = 0; p < passes; p++) { const rgb = new Float32Array(cur.rgb.length); for (let y = 0; y < cur.h; y++) for (let x = 0; x < cur.w; x++) for (let c = 0; c < 3; c++) { let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(cur.w - 1, Math.max(0, x + dx)), yy = Math.min(cur.h - 1, Math.max(0, y + dy)); s += cur.rgb[(yy * cur.w + xx) * 3 + c]; n++; } rgb[(y * cur.w + x) * 3 + c] = s / n; } cur = { ...cur, rgb }; } return cur; };
  const base = score(reference, sharp).total, light = score(reference, blurred(sharp, 2)).total, heavy = score(reference, blurred(sharp, 6)).total;
  assert.ok(light > base + 0.01 && heavy > light, `${base} < ${light} < ${heavy}`);
  assert.ok(score(reference, blurred(sharp, 6)).components.sharpness > 0.2);
});
test('a material colour change must not look like a lighting win', () => {
  const blueMat = { albedo: [0.45, 0.62, 0.8] }, redMat = { albedo: [0.82, 0.55, 0.42] };   // similar luma, different hue
  const reference = final(REF, blueMat, 3);                      // photographed product: blue, correct lighting
  const wrongLight = lights([40, 20, 0.6], [60, 10, 0.25]);
  const wrongLightWrongMaterial = final(wrongLight, redMat), wrongLightRightMaterial = final(wrongLight, blueMat);
  const rightLightWrongMaterial = final(REF, redMat);
  const rmse = (a, b) => Math.sqrt(a.rgb.reduce((n, v, i) => n + (v - b.rgb[i]) ** 2, 0) / a.rgb.length);
  assert.ok(rmse(reference, wrongLightRightMaterial) < rmse(reference, wrongLightWrongMaterial), 'raw pixel error does reward the recolour');
  const a = score(reference, wrongLightWrongMaterial), b = score(reference, wrongLightRightMaterial);
  assert.ok(Math.abs(a.total - b.total) < 0.03, `recolouring alone moved the lighting score by ${Math.abs(a.total - b.total)}`);
  const good = score(reference, rightLightWrongMaterial);
  assert.ok(good.total < a.total - 0.1 && good.total < b.total - 0.1, 'correct lighting on the wrong material still beats wrong lighting on the right material');
  assert.equal(good.diagnostics.global_tint_shift_suspected, true, 'a global tint shift is reported separately, not scored as lighting');
  assert.equal(b.diagnostics.global_tint_shift_suspected, false);
});
test('exposure is reported separately from lighting structure', () => {
  const reference = final(REF, {}, 3), dim = final(lights([-40, 45, 0.5], [60, 10, 0.125]), {}, 2);
  const s = score(reference, dim);
  assert.ok(s.components.exposure > 0.2 && s.components.tone_structure < 0.1);
});
test('objective scores are stable across noise seeds and respond monotonically to key-light azimuth error', () => {
  const reference = final(REF, {}, 3);
  assert.ok(score(reference, final(REF, {}, 4)).total < 0.01);
  const at = az => score(reference, final(lights([az, 45, 1.0], [60, 10, 0.25]))).total;
  assert.ok(at(-40) < at(-55) && at(-55) < at(-75), `${at(-40)} ${at(-55)} ${at(-75)}`);
});
test('masks restrict the objective, bad inputs are refused, and no percentage is produced', () => {
  const a = final(REF, {}, 3), b = final(lights([-40, 45, 1.0], [60, 10, 0.25]), {}, 2);
  const mask = new Uint8Array(a.w * a.h).fill(1);
  assert.ok(score(a, b, mask).total < 0.05);
  assert.throws(() => objectives.score(a, { w: 3, h: 3, rgb: new Float32Array(27) }), /same size/);
  assert.throws(() => objectives.describe({ w: 2, h: 2, rgb: new Float32Array(3) }), /not a valid image/);
  const result = score(a, b); assert.ok(result.total >= 0 && result.total <= 1); assert.match(result.diagnostics.note, /Not a similarity percentage/);
  assert.equal(Object.keys(result).some(k => /percent/i.test(k)), false);
});

// ---- derivative-free search ----------------------------------------------------------------------------------------
const bowl = (target, scales = [1, 1, 1]) => x => x.reduce((n, v, i) => n + scales[i] * (v - target[i]) ** 2, 0);
const BOUNDS3 = [{ name: 'a', lo: -10, hi: 10 }, { name: 'b', lo: -10, hi: 10 }, { name: 'c', lo: 0.1, hi: 10, log: true }];
test('coordinate and Powell searches find the minimum of a smooth bowl within a hard budget', async () => {
  const f = bowl([3, -2, 2], [1, 1, 0.5]);
  for (const search of [coordinateSearch, powellSearch]) {
    let calls = 0;
    const r = await search({ x0: [-6, 6, 7], bounds: BOUNDS3, budget: 400, evaluate: async x => { calls++; return f(x); } });
    assert.ok(r.score < 0.1, `${r.method} ended at ${r.score}`); assert.ok(calls <= 400 && r.evaluations.length === calls);
  }
});
test('the evaluation budget is a hard cap and bounds are never violated', async () => {
  const seen = [];
  const r = await coordinateSearch({ x0: [0, 0, 1], bounds: BOUNDS3, budget: 17, evaluate: async x => { seen.push(x); return -x[0] - x[1]; } });
  assert.equal(seen.length, 17); assert.equal(r.evaluations.length, 17);
  for (const x of seen) assert.ok(x[0] >= -10 && x[0] <= 10 && x[1] >= -10 && x[1] <= 10 && x[2] >= 0.1 - 1e-9 && x[2] <= 10 + 1e-9);
  await assert.rejects(() => optimize({ x0: [0, 0, 1], bounds: BOUNDS3, evaluate: async () => 0, budget: 5 }), /too small/);
  await assert.rejects(() => coordinateSearch({ x0: [0], bounds: [{ name: 'x', lo: 1, hi: 0 }], evaluate: async () => 0, budget: 5 }), /Invalid bounds/);
  const aborted = new AbortController(); aborted.abort(new Error('stop'));
  await assert.rejects(() => coordinateSearch({ x0: [0, 0, 1], bounds: BOUNDS3, evaluate: async () => 0, budget: 5, signal: aborted.signal }), /stop/);
});
test('optimize measures baseline repeat noise, re-validates finalists, and respects the total budget', async () => {
  const f = bowl([3, -2, 2]);
  let seed = 1; const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.02; };
  const contexts = [];
  const r = await optimize({ x0: [-6, 6, 7], bounds: BOUNDS3, budget: 120, method: 'coordinate', evaluate: async (x, ctx) => { contexts.push(ctx); return f(x) + noise(); } });
  assert.ok(r.accepted); assert.equal(r.evaluations_used, contexts.length); assert.ok(r.evaluations_used <= 120);
  assert.equal(r.baseline.n, 3); assert.ok(r.baseline.sd >= 0); assert.ok(r.finalists.length >= 1 && r.finalists[0].n === 2);
  assert.ok(contexts.some(c => c.stage === 'finalist' && c.quality === 'final'), 'finalists are re-evaluated at the higher quality');
  assert.ok(contexts.filter(c => c.stage === 'baseline').length === 3);
  assert.ok(f(r.x) < f([-6, 6, 7]) / 4);
});
test('pure noise is not accepted as an improvement: the starting point is kept', async () => {
  let seed = 7; const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.2; };
  const r = await optimize({ x0: [1, 1, 1], bounds: BOUNDS3, budget: 60, evaluate: async () => 1 + noise(), floor: 0.05 });
  assert.equal(r.accepted, false); assert.deepEqual(r.x, [1, 1, 1]); assert.match(r.reason, /starting point is kept/);
});
test('a finalist that looked good only at search quality is rejected on re-validation', async () => {
  const r = await optimize({ x0: [0, 0, 1], bounds: BOUNDS3, budget: 60, floor: 0.01, evaluate: async (x, ctx) => ctx.quality === 'final' ? 1 : 1 - Math.min(0.5, Math.abs(x[0]) * 0.05) });
  assert.equal(r.accepted, false);
});
test('summarizeRepeats ignores non-finite values', () => {
  assert.deepEqual(summarizeRepeats([1, 3, NaN]), { n: 2, mean: 2, sd: Math.SQRT2 });
});

// ---- equal-budget comparison with the existing vision loop (synthetic renderer, stand-in vision) ------------------
test('the harness runs the real director loop and counts every render against one budget', async () => {
  const v = await harness.runVisionLoop({ seed: 1, budget: 16 });
  assert.equal(v.phase, 'complete', v.error); assert.ok(v.renders >= 8 && v.renders <= 12, `${v.renders} renders`); assert.equal(v.vision_calls >= 1, true);
  const capped = await harness.runVisionLoop({ seed: 1, budget: 6 });
  assert.equal(capped.phase, 'complete'); assert.ok(capped.renders <= 6);
});
test('equal budget: the solver is started from the same first estimate and never exceeds the renders the vision loop used', async () => {
  const v = await harness.runVisionLoop({ seed: 2 }), s = await harness.runSolver({ seed: 2, budget: v.renders, method: 'coordinate' });
  assert.deepEqual(s.start.map(n => +n.toFixed(6)), v.start.map(n => +n.toFixed(6)));
  assert.ok(s.renders <= v.renders && s.result.evaluations_used === s.renders);
  const again = await harness.runSolver({ seed: 2, budget: v.renders, method: 'coordinate' });
  assert.deepEqual(again.x, s.x, 'the synthetic comparison is deterministic for a fixed seed');
});
test('synthetic comparison: coordinate search beats the stand-in vision loop on held-out objective at equal and larger budgets', async () => {
  const seeds = [1, 2, 3], vision = [], solver12 = [], solver48 = [];
  for (const seed of seeds) {
    const v = await harness.runVisionLoop({ seed }), l = await harness.runVisionLoop({ seed, mode: 'local' });
    vision.push((harness.heldOut(v.x, { seed }).objective_same_view + harness.heldOut(l.x, { seed }).objective_same_view) / 2);
    solver12.push(harness.heldOut((await harness.runSolver({ seed, budget: v.renders })).x, { seed }).objective_same_view);
    solver48.push(harness.heldOut((await harness.runSolver({ seed, budget: 48 })).x, { seed }).objective_same_view);
  }
  const mean = a => a.reduce((n, v) => n + v, 0) / a.length;
  assert.ok(mean(solver12) < mean(vision), `equal budget: solver ${mean(solver12)} vs vision ${mean(vision)}`);
  assert.ok(mean(solver48) < mean(solver12), `a larger budget helps: ${mean(solver48)} vs ${mean(solver12)}`);
  assert.ok(mean(solver48) < mean(vision) / 2);
});
test('the solver never reports a rig worse than its starting estimate on the search objective', async () => {
  for (const seed of [1, 2, 3, 4]) {
    const s = await harness.runSolver({ seed, budget: 24 });
    const start = harness.heldOut(s.start, { seed }).objective_same_view, end = harness.heldOut(s.x, { seed }).objective_same_view;
    assert.ok(end <= start + 0.02, `seed ${seed}: ${end} vs start ${start}`);
  }
});

// ---- light-response basis (synthetic, linear only) --------------------------------------------------------------------
const SOURCES = [{ id: 'key', az: -40, el: 45 }, { id: 'rim', az: 150, el: 20 }, { id: 'fill', az: 60, el: 10 }];
function basisFixture(scene = {}) {
  const base = synthetic.renderLinear({ lights: [] }, scene).linear;
  const basis = SOURCES.map(s => ({ id: s.id, linear: Float32Array.from(synthetic.renderLinear({ lights: [{ az: s.az, el: s.el, gain: 1 }] }, scene).linear, (v, i) => v - base[i]) }));
  const mix = weights => synthetic.renderLinear({ lights: SOURCES.map(s => ({ az: s.az, el: s.el, gain: weights[s.id] })).filter(l => l.gain > 0) }, scene).linear;
  return { base, basis, mix };
}
test('NNLS recovers nonnegative intensities and clamps an infeasible one to zero', () => {
  const columns = [[1, 0, 0], [0, 1, 0], [1, 1, 0]];
  const r = basisFit.nnls(columns, [2, 3, 0]);
  assert.ok(r.x.every(v => v >= 0) && r.residual_rms < 0.9);
  const exact = basisFit.nnls([[1, 2, 3], [0, 1, 1]], [1 + 0, 2 + 1, 3 + 1]);
  assert.ok(Math.abs(exact.x[0] - 1) < 1e-9 && Math.abs(exact.x[1] - 1) < 1e-9);
  const negative = basisFit.nnls([[1, 0], [0, 1]], [2, -3]);
  assert.deepEqual(negative.x.map(v => +v.toFixed(9)), [2, 0]);
  assert.throws(() => basisFit.nnls([[1, 2], [1]], [1, 2]));
});
test('light-response basis: fit on one mixture, predict held-out mixtures within the noise criterion (synthetic)', () => {
  const { base, basis, mix } = basisFixture();
  const truth = { key: 0.9, rim: 0.4, fill: 0.15 }, target = mix(truth);
  const fit = basisFit.fitIntensities({ basis, base, target });
  for (const id of Object.keys(truth)) assert.ok(Math.abs(fit.weights[id] - truth[id]) < 1e-3, `${id}: ${fit.weights[id]}`);
  assert.ok(fit.relative_residual < 1e-3);
  const heldOut = [{ key: 0.2, rim: 1.2, fill: 0.5 }, { key: 1.5, rim: 0, fill: 0.3 }].map(weights => ({ weights, actual: mix(weights) }));
  const verdict = basisFit.validate({ basis, base, mixtures: heldOut, noise_rms: 0, tolerance: 0.02 });
  assert.equal(verdict.accepted, true, JSON.stringify(verdict));
});
test('with render noise the held-out criterion scales with the measured noise instead of a guess', () => {
  const { base, basis, mix } = basisFixture();
  let s = 3; const noisy = (img, sd) => Float32Array.from(img, v => { s = (s * 16807) % 2147483647; return v + (s / 2147483647 - 0.5) * sd * 3.46; });
  const weights = { key: 0.5, rim: 0.5, fill: 0.5 };
  const a = noisy(mix(weights), 0.02), b = noisy(mix(weights), 0.02);
  const noise_rms = Math.sqrt(a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0) / a.length / 2);
  const verdict = basisFit.validate({ basis, base, mixtures: [{ weights, actual: a }], noise_rms, tolerance: 0.001 });
  assert.ok(verdict.results[0].limit_rms >= 3 * noise_rms); assert.ok(noise_rms > 0.005); assert.equal(verdict.accepted, true);
  const strict = basisFit.validate({ basis, base, mixtures: [{ weights, actual: a }], noise_rms: 0, tolerance: 0.001 });
  assert.equal(strict.accepted, false, 'without the measured noise the same data would be rejected as a model failure');
});
test('the shortcut is rejected when display-space data is used or a source moves', () => {
  const { base, basis, mix } = basisFixture();
  const display = linear => Float32Array.from(linear, v => Math.min(1, Math.pow(Math.max(0, v) * 1.6, 1 / 2.2)));   // tone curve + clipping
  const weights = { key: 1.4, rim: 0.9, fill: 0.5 };
  const toneMapped = basisFit.validate({ basis: basis.map(b => ({ ...b, linear: display(b.linear) })), base: display(base), mixtures: [{ weights, actual: display(mix(weights)) }], tolerance: 0.02 });
  assert.equal(toneMapped.accepted, false, 'tone-mapped and clipped data break linear superposition');
  const moved = synthetic.renderLinear({ lights: [{ az: -10, el: 45, gain: 1.0 }, { az: 150, el: 20, gain: 0.4 }] }).linear;
  const verdict = basisFit.validate({ basis, base, mixtures: [{ weights: { key: 1.0, rim: 0.4, fill: 0 }, actual: moved }], tolerance: 0.02 });
  assert.equal(verdict.accepted, false, 'a basis cannot predict the response of a source that moved');
  assert.throws(() => basisFit.validate({ basis, base, mixtures: [] }), /held-out/);
});
