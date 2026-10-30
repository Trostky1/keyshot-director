// Injected scene adapter for the reconstruction session: a synthetic renderer instead of KeyShot, a fake clock, and a recording
// scene. Nothing here touches KeyShot, the bridge or the network; it exists so every session stage can be tested offline.
const fs = require('fs'), os = require('os'), path = require('path');
const { createReceiptStore } = require('../server/job-receipt');
const { encodeRgb } = require('../server/png');
const synthetic = require('./synthetic_renderer');

const TRUTH_RIG = { lights: [{ az: -40, el: 45, gain: 1.0 }, { az: 60, el: 10, gain: 0.25 }] };
const ORIGINAL_RIG = { lights: [{ az: 0, el: 30, gain: 0.5 }] };   // the scene's own lighting before any job
const POSE = { az: 25, el: 18, dist: 1500, fov: 38, pivot: [10, 130, -20] };
// A circular outline around the sphere (orthographic view: radius 0.55 of a 2.4 wide frame), as a user would draw it.
const OUTLINE = { points: Array.from({ length: 24 }, (_, i) => [0.5 + 0.245 * Math.cos(i * Math.PI / 12), 0.5 + 0.245 * Math.sin(i * Math.PI / 12)]) };

function toReferencePng(rig, { scene = {}, seed = 9001 } = {}) {
  return encodeRgb(synthetic.render(rig, { scene, seed, quality: 'final' }));
}

function createFixture({ truth = TRUTH_RIG, original = ORIGINAL_RIG, scene = {}, renderMs = 1000, applyMs = 0, hiddenMs = 0, receipts = true, root = null } = {}) {
  const dir = root || fs.mkdtempSync(path.join(os.tmpdir(), 'kd-recon-'));
  const state = { rig: original, pose: { ...POSE, pivot: POSE.pivot.slice() }, clock: 1_000_000, sceneId: 'scene-A', calls: [], renders: 0, applied: 0, updates: 0, restored: 0,
    sceneFiles: { name: 'Product.bip' }, onRender: null, original };
  const renderer = synthetic.budgeted(10_000, { scene, baseSeed: 20_000 });
  const advance = ms => { state.clock += ms; };
  const deps = {
    root: path.join(dir, 'jobs'),
    now: () => state.clock,
    receipts: receipts ? createReceiptStore({ root: path.join(dir, 'jobs') }) : undefined,
    snapshot: async () => ({ subject: { center: [0, 0, 0], size: [1, 1, 1], span: 1, models: ['Product'], min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, camera: { ...state.pose }, checkpoint: { name: 'cam' },
      environment: { hdri: 'x' }, lights: {}, selectOnly: true, scene_context: { big: 'x'.repeat(2000) }, studio: {} }),
    sceneIdentity: async () => { state.calls.push('sceneIdentity'); return typeof state.sceneId === 'function' ? state.sceneId(state) : state.sceneId; },
    baseline: async () => ({ unit: 'mm', image_style: null, note: 'synthetic' }),
    inventory: async () => [],
    readPose: async () => ({ ...state.pose, pivot: state.pose.pivot.slice() }),
    applyPose: async pose => { state.calls.push('applyPose'); state.pose = { ...pose, pivot: pose.pivot.slice() }; },
    apply: async (plan, opts) => {
      state.calls.push('apply'); state.applied++; advance(applyMs);
      const ids = plan.lights.map((_, i) => `photo_${opts.id}_photo_${i + 1}`); ids.forEach(id => opts.declareOwned?.({ kind: 'light', id }));
      state.rig = { lights: plan.lights.map(l => ({ az: l.az, el: l.el, gain: l.gain })) };
      state.lastPlan = plan;
      return { power_mode: plan.power_mode, lights: ids.map(id => ({ id })) };
    },
    update: async plan => { state.updates++; advance(applyMs + hiddenMs); state.rig = { lights: plan.lights.map(l => ({ az: l.az, el: l.el, gain: l.gain })) }; state.lastPlan = plan; },
    restore: async () => { state.calls.push('restore'); state.restored++; state.rig = state.original; },
    capture: async (file, aspect, secs) => {
      state.renders++; state.onRender?.(state);
      advance(renderMs);
      fs.writeFileSync(file, encodeRgb(renderer.render(state.rig, { quality: secs >= 4 ? 'final' : 'search' })));
    },
    saveScene: async targets => {
      state.calls.push('saveScene');
      for (const file of Object.values(targets)) fs.writeFileSync(file, 'synthetic scene bytes');
      const before = state.sceneFiles.name; if (targets.bip) state.sceneFiles.name = path.basename(targets.bip);
      return { saved: Object.keys(targets), scene_file_before: before, scene_file_after: state.sceneFiles.name };
    },
  };
  return { deps, state, dir, referenceFor: (rig = truth, opts) => toReferencePng(rig, { scene, ...opts }), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const image = png => 'data:image/png;base64,' + png.toString('base64');
module.exports = { createFixture, TRUTH_RIG, ORIGINAL_RIG, OUTLINE, POSE, image, toReferencePng };
