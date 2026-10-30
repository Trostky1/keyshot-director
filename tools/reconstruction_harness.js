// Equal-budget comparison of the EXISTING vision-refinement loop (the real photo.createDirector, photo-refinement objective and
// acceptance gate) against a derivative-free solver, on the synthetic renderer only (research E07, offline half).
// The "vision" is a STAND-IN policy with a fixed estimation error; real vision behavior is unknown, so these results characterise
// the harness and the solver, not KeyShot and not a real vision model. Nothing here touches a scene, the bridge or the network.
const fs = require('fs'), os = require('os'), path = require('path');
const { createDirector } = require('../server/photo');
const { normalizeMask, maskedStatistics } = require('../server/image-mask');
const { optimize } = require('../server/derivative-free');
const objectives = require('../server/lighting-objectives');
const { SPACES } = require('../server/colour-contract');
const synthetic = require('./synthetic_renderer');
const { encodePng } = require('./png_fixture');

// Reduced parameter set: key light azimuth, elevation and (log) gain, plus the fill gain. Topology (two lights) is locked.
const BOUNDS = [{ name: 'key_az', lo: -120, hi: 120 }, { name: 'key_el', lo: 5, hi: 80 }, { name: 'key_gain', lo: 0.2, hi: 5, log: true }, { name: 'fill_gain', lo: 0.05, hi: 2, log: true }];
const FILL = { az: 60, el: 10 };
const toRig = x => ({ lights: [{ az: x[0], el: x[1], gain: x[2] }, { ...FILL, gain: x[3] }] });
const fromPlan = plan => [plan.lights[0].az, plan.lights[0].el, plan.lights[0].gain, plan.lights[1].gain];
const TRUTH = [-40, 45, 1.0, 0.25];
const HELD_OUT_VIEW = { yaw: 25 };

function gaussianStream(seed) { const r = synthetic.rng(seed); return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
const clampTo = (x, bounds) => x.map((v, i) => Math.min(bounds[i].hi, Math.max(bounds[i].lo, v)));
// A fixed-accuracy "vision" estimate of the true rig. mode 'independent': every call is a fresh estimate; 'local': a perturbation of the best plan.
// The stand-in has a PERSISTENT misperception (a fixed per-seed bias, as a real model keeps misreading the same cue) plus smaller per-call noise;
// a policy centred on the truth with only fresh noise would be an unrealistically strong oracle.
function visionPolicy({ truth = TRUTH, seed = 1, sigma = { az: 18, el: 12, gain: 0.35, fill: 0.5 }, mode = 'independent' } = {}) {
  const normal = gaussianStream(seed);
  const bias = [normal() * sigma.az, normal() * sigma.el, normal() * sigma.gain, normal() * sigma.fill];
  const estimate = base => clampTo([base[0] + bias[0] + normal() * sigma.az / 3, base[1] + bias[1] + normal() * sigma.el / 3, base[2] * Math.exp(bias[2] + normal() * sigma.gain / 3), base[3] * Math.exp(bias[3] + normal() * sigma.fill / 3)], BOUNDS);
  let calls = 0, firstEstimate = null;
  const ask = async (_images, context) => {
    calls++;
    let x;
    if (calls === 1) x = firstEstimate = estimate(truth);
    else if (mode === 'local') {
      const best = JSON.parse(context.slice(context.lastIndexOf('Current best plan:\n') + 'Current best plan:\n'.length));
      const base = fromPlan(best), half = estimate(truth).map((v, i) => (v + base[i]) / 2);   // half-step from the best plan toward a fresh (equally biased) guess
      x = clampTo(half, BOUNDS);
    } else x = estimate(truth);
    return { engine: 'stand-in-vision', plan: { title: 'stand-in', lights: x.length ? [{ type: 'area', az: x[0], el: x[1], gain: x[2], d: 3, w: 1, h: 1 }, { type: 'area', ...FILL, gain: x[3], d: 3, w: 1, h: 1 }] : [] } };
  };
  return { ask, get calls() { return calls; }, get firstEstimate() { return firstEstimate; } };
}

function toPng(img) {
  return encodePng(img.w, img.h, (x, y) => [0, 1, 2].map(c => img.rgb[(y * img.w + x) * 3 + c] * 255));
}

// Run the real director loop against the synthetic renderer. Returns the final rig and the renders consumed.
async function runVisionLoop({ truth = TRUTH, seed = 1, mode = 'independent', maxAttempts = 3, budget = 16, objective = 'highlight_position', scene = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-synthetic-')), renderer = synthetic.budgeted(budget, { scene, baseSeed: 5000 + seed * 100 });
  const reference = synthetic.render(toRig(truth), { scene, seed: 9000 + seed, quality: 'final' }), referencePng = toPng(reference);
  const mask = normalizeMask({ kind: 'rect' });
  const policy = visionPolicy({ truth, seed, mode });
  const BASELINE = { lights: [{ az: 0, el: 30, gain: 0.5 }] };   // whatever lighting the scene had before the match
  let rig = BASELINE;
  const evidenceFor = (id, image) => {
    const samples = []; for (let i = 0; i < image.w * image.h; i++) { const rgb = [image.rgb[i * 3], image.rgb[i * 3 + 1], image.rgb[i * 3 + 2]];
      samples.push({ u: ((i % image.w) + 0.5) / image.w, v: (((i / image.w) | 0) + 0.5) / image.h, l: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], rgb }); }
    const stats = maskedStatistics(samples);
    return { id: String(id), status: 'verified_shape', output: { analysis: { available: true, product_mask: { bounds_normalized: { x0: 0, y0: 0, x1: 1, y1: 1 } },
      product: { p05_luma: stats.p05_luma, p95_luma: stats.p95_luma }, masked_beauty: { ...stats, colour_space: SPACES.DISPLAY, mask_signature: mask.signature },
      measurement_scope: { kind: 'projected_bounds_roi' },
      comparison_to: id ? { result: { available: true, mask_agreement: { suitable_for_lighting_only_comparison: true } } } : null } } };
  };
  let evidenceCounter = 0;
  const director = createDirector({ root,
    snapshot: async () => ({ subject: { span: 1 }, camera: {} }),
    ask: policy.ask,
    apply: async plan => { rig = toRig(fromPlan(plan)); return { lights: plan.lights.length }; },
    restore: async () => { rig = BASELINE; },
    capture: async file => { fs.writeFileSync(file, toPng(renderer.render(rig, { quality: 'search' }))); },
    lightingEvidence: async (runId) => evidenceFor(runId ? ++evidenceCounter : 0, renderer.render(rig, { quality: 'search' })),
  });
  try {
    await director.start({ image: 'data:image/png;base64,' + referencePng.toString('base64'),
      refinement: { objective, reference_region: { x0: 0, y0: 0, x1: 1, y1: 1 }, max_attempts: maxAttempts, max_captures: Math.min(16, budget) } });
    const status = await director.wait();
    return { kind: 'vision_loop', mode, phase: status.phase, error: status.error || null, rig, x: rig !== BASELINE ? [rig.lights[0].az, rig.lights[0].el, rig.lights[0].gain, rig.lights[1].gain] : null,
      renders: renderer.used, accepted_attempts: status.result?.refinement?.accepted_attempts ?? 0, vision_calls: policy.calls, start: policy.firstEstimate, reference };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// The derivative-free solver, started from the same first vision estimate, spending exactly `budget` renders at most.
async function runSolver({ truth = TRUTH, seed = 1, budget, method = 'coordinate', start = null, scene = {}, optimizerOptions = {} }) {
  const renderer = synthetic.budgeted(budget, { scene, baseSeed: 7000 + seed * 100 });
  const reference = synthetic.render(toRig(truth), { scene, seed: 9000 + seed, quality: 'final' }), ref = objectives.describe(reference, null);
  let x0 = start;
  if (!x0) { const policy = visionPolicy({ truth, seed }); await policy.ask([], ''); x0 = policy.firstEstimate; }   // the same first estimate the vision loop starts from
  const evaluate = (x, ctx) => objectives.compare(ref, objectives.describe(renderer.render(toRig(x), { quality: ctx.quality }), null)).total;
  const result = await optimize({ x0, bounds: BOUNDS, evaluate, budget, method, floor: 0.002, searchOptions: { step0: 0.12 }, ...optimizerOptions });
  return { kind: 'solver_' + method, x: result.x, accepted: result.accepted, renders: renderer.used, result, start: x0, reference };
}

// Held-out checks that neither method optimized against: a fresh noise seed at final quality, and a rotated camera.
function heldOut(x, { truth = TRUTH, seed = 1, scene = {} } = {}) {
  const same = synthetic.render(toRig(x), { scene, seed: 31000 + seed, quality: 'final' });
  const reference = synthetic.render(toRig(truth), { scene, seed: 32000 + seed, quality: 'final' });
  const turnedScene = { ...scene, yaw: HELD_OUT_VIEW.yaw };
  const turned = synthetic.render(toRig(x), { scene: turnedScene, seed: 33000 + seed, quality: 'final' });
  const turnedReference = synthetic.render(toRig(truth), { scene: turnedScene, seed: 34000 + seed, quality: 'final' });
  const rmse = (a, b) => Math.sqrt(a.rgb.reduce((n, v, i) => n + (v - b.rgb[i]) ** 2, 0) / a.rgb.length);
  return { objective_same_view: objectives.score(reference, same).total, objective_held_out_view: objectives.score(turnedReference, turned).total,
    rmse_same_view: rmse(reference, same), rmse_held_out_view: rmse(turnedReference, turned),
    parameter_error: { key_az_deg: Math.abs(x[0] - truth[0]), key_el_deg: Math.abs(x[1] - truth[1]), key_gain_ratio: Math.exp(Math.abs(Math.log(x[2] / truth[2]))), fill_gain_ratio: Math.exp(Math.abs(Math.log(x[3] / truth[3]))) } };
}

module.exports = { BOUNDS, TRUTH, toRig, fromPlan, visionPolicy, runVisionLoop, runSolver, heldOut, toPng };
