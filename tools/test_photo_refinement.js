const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { createDirector, captureDimensions, measurementTarget } = require('../server/photo');
const { settings, lockedPlan, decision } = require('../server/photo-refinement');
const { normalizeMask } = require('../server/image-mask');
// Default measurement: one shared whole-rectangle mask on both the reference and the render.
const SIGNATURE = normalizeMask({ kind: 'rect' }).signature;
const maskedBeauty = (p95, p05 = 0) => ({ mask_signature: SIGNATURE, colour_space: 'display_srgb', p05_luma: p05, p50_luma: p95 / 2, p95_luma: p95, highlight: null });
function png(gray = 180) {
  const chunk = (kind, data) => { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(kind, 4); data.copy(b, 8); return b; };
  const h = Buffer.alloc(13); h.writeUInt32BE(64); h.writeUInt32BE(64, 4); h[8] = 8; h[9] = 2;
  const raw = Buffer.alloc(64 * 193, gray); for (let y = 0; y < 64; y++) raw[y * 193] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const region = { x0: 0, y0: 0, x1: 1, y1: 1 };
const comparison = { available: true, mask_agreement: { suitable_for_lighting_only_comparison: true } };
function rig(t, gains, evidenceOverride) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-refine-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let active = 0, asks = 0, captures = 0, reads = 0; const applied = [], evidenceInputs = [];
  const d = createDirector({ root,
    snapshot: async () => ({ subject: { span: 100 }, camera: {} }),
    ask: async () => ({ engine: 'stub', plan: { lights: [{ gain: gains[Math.min(asks++, gains.length - 1)] }] } }),
    apply: async plan => { active = plan.lights[0].gain; applied.push(active); return { gain: active }; },
    restore: async () => { active = 0; applied.push('baseline'); },
    capture: async file => { captures++; fs.writeFileSync(file, png(Math.round(active * 100))); },
    lightingEvidence: async (id, contract) => {
      evidenceInputs.push(contract); reads++;
      if (evidenceOverride) return evidenceOverride({ active, reads, id });
      return { id: String(reads), output: { analysis: { available: true,
        product_mask: { bounds_normalized: region }, product: { p05_luma: 0, p95_luma: active }, masked_beauty: maskedBeauty(active),
        measurement_scope: { kind: 'projected_bounds_roi' }, comparison_to: id ? { result: comparison } : null } } };
    }
  });
  return { d, applied, evidenceInputs, get active() { return active; }, get captures() { return captures; } };
}
const input = { image: 'data:image/png;base64,' + png().toString('base64'), refinement: { objective: 'tone', reference_region: region, max_attempts: 2 } };
test('keeps an improved candidate and restores a later regression to best, not initial', async t => {
  const r = rig(t, [0.2, 0.65, 0.3]); await r.d.start(input); const s = await r.d.wait();
  assert.equal(s.phase, 'complete'); assert.deepEqual(r.applied, [0.2, 0.65, 0.3, 0.65]);
  assert.equal(s.result.application.gain, 0.65); assert.equal(s.result.refinement.accepted_attempts, 1);
  assert.equal(s.result.refinement.captures_used, r.captures + r.evidenceInputs.length);
  assert.ok(r.evidenceInputs.every(c => c.aspect === 1));
  assert.deepEqual(fs.readFileSync(r.d.file(s.id, 'after')), png(65));
  const recipe = JSON.parse(fs.readFileSync(r.d.file(s.id, 'recipe'))); assert.equal(recipe.lights[0].gain, 0.65);
});
test('unavailable repeat measurements never apply a speculative candidate', async t => {
  const r = rig(t, [0.2, 0.65], ({ active, reads }) => ({ id: String(reads), output: { analysis: { available: true,
    product_mask: { bounds_normalized: region }, product: { p95_luma: active }, masked_beauty: maskedBeauty(active), measurement_scope: { kind: 'projected_bounds_roi' } } } }));
  await r.d.start(input); const s = await r.d.wait(); assert.equal(s.phase, 'complete'); assert.deepEqual(r.applied, [0.2]);
});
test('failed candidate capture restores the last complete look', async t => {
  const r = rig(t, [0.2, 0.65], ({ active, reads, id }) => {
    if (reads === 3) throw new Error('pass unavailable');
    return { id: String(reads), output: { analysis: { available: true, product_mask: { bounds_normalized: region },
      product: { p95_luma: active }, masked_beauty: maskedBeauty(active), measurement_scope: { kind: 'projected_bounds_roi' }, comparison_to: id ? { result: comparison } : null } } };
  });
  await r.d.start(input); const s = await r.d.wait(); assert.equal(s.phase, 'complete'); assert.deepEqual(r.applied, [0.2, 0.65, 0.2]);
  assert.equal(s.result.refinement.accepted_attempts, 0);
});
test('hard capture limit retains best without starting another candidate', async t => {
  const r = rig(t, [0.2, 0.65, 0.7]); await r.d.start({ ...input, refinement: { ...input.refinement, max_captures: 6 } });
  const s = await r.d.wait(); assert.equal(s.result.refinement.captures_used, 6); assert.deepEqual(r.applied, [0.2, 0.65]);
});
test('objective improvement smaller than measured repeat noise is rejected', () => {
  const e = p95 => ({ available: true, beauty_product: { p95_luma: p95 }, product_mask: { bounds_normalized: region }, measurement_scope: { kind: 'projected_bounds_roi' }, comparison_to: comparison });
  const v = decision(e(0.3), e(0.32), e(0.33), { p95_luma: 0.7 }, 'tone'); assert.equal(v.accepted, false); assert.ok(v.required_improvement > 0.05);
});
test('source locks preserve identity, count, absent color fields and camera intent', () => {
  const baseline = { lights: [{ id: 'a', type: 'area', gain: 1, az: 20 }], shot: { fov: 35 }, environment: { brightness: 1 } };
  const candidate = { lights: [{ type: 'ies', gain: 10, az: 80, rgb: [1,0,1] }, {}], shot: { fov: 70 }, environment: { brightness: 8 } };
  const result = lockedPlan(candidate, baseline, { power: true, color: true, position: true, environment: true });
  assert.equal(result.lights.length, 1); assert.equal(result.lights[0].gain, 1); assert.equal(result.lights[0].az, 20);
  assert.equal(result.lights[0].rgb, undefined); assert.equal(result.lights[0].type, 'area'); assert.deepEqual(result.shot, baseline.shot);
});
test('invalid regions and unbounded budgets fail before touching scene', async t => {
  assert.throws(() => settings({ reference_region: { ...region, x1: 0 } })); assert.throws(() => settings({ max_attempts: 99 }));
  const r = rig(t, [1]); await assert.rejects(r.d.start({ ...input, refinement: { max_captures: Infinity } })); assert.equal(r.applied.length, 0);
});
test('portrait and landscape capture contracts use consistent bounded dimensions', () => {
  assert.deepEqual(captureDimensions(2), { width: 640, height: 320 });
  assert.deepEqual(captureDimensions(0.5), { width: 320, height: 640 });
  assert.deepEqual(captureDimensions(4), { width: 640, height: 160 });
  assert.deepEqual(captureDimensions(0.05), { width: 32, height: 640 });
  assert.throws(() => captureDimensions(40)); assert.throws(() => captureDimensions(0.025));
});
test('measurement contract handles actual selected bounds arrays and refuses unknown or shifted lenses', () => {
  const snapshot = { subject: { min: [-100,-100,-100], max: [100,100,100] }, scene_context: {
    camera: { lens_type: 'Perspective' }, target: { selection: [{ node_id: 12, bounds: [[-10,-10,-10],[10,10,10]] }] } } };
  const pose = { az: 0, el: 0, dist: 400, fov: 40, pivot: [0,0,0] };
  const selected = measurementTarget(snapshot, pose, 1); assert.equal(selected.id, '12'); assert.ok(selected.region.x1 - selected.region.x0 < 0.1);
  snapshot.scene_context.target.selection = []; assert.equal(measurementTarget(snapshot, pose, 1).id, 'whole-product');
  snapshot.scene_context.camera.lens_parameters = { shift: [0.2,0] }; assert.throws(() => measurementTarget(snapshot, pose, 1));
  snapshot.scene_context.camera = {}; assert.throws(() => measurementTarget(snapshot, pose, 1));
});
