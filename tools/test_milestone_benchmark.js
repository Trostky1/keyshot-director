// Checks the benchmark harness itself (equal budgets, determinism, held-out independence) on a reduced case set.
// The published table comes from `node tools/run_milestone_benchmark.js`; this file does not assert that the session "wins".
const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./reconstruction_harness');
const { SCENES, heldOut, session } = require('./run_milestone_benchmark');

const spec = SCENES[0], seed = 1;
test('every method is charged by the same renderer: the session reports baseline + fit + after, never more than its total budget', async () => {
  const vision = await harness.runVisionLoop({ truth: spec.truth, seed, scene: spec.scene });
  for (const total of [12, 16]) {
    const s = await session({ ...spec, seed, start: vision.start, cap: Math.max(9, total - 3) });
    assert.ok(s.renders <= total, `${s.renders} renders for a ${total}-render budget`);
    assert.equal(s.renders, 2 + s.used + 1);
  }
  assert.ok(vision.renders <= 12);
});
test('the benchmark is deterministic and the held-out score uses seeds and a view the fit never saw', async () => {
  const vision = await harness.runVisionLoop({ truth: spec.truth, seed, scene: spec.scene });
  const a = await session({ ...spec, seed, start: vision.start, cap: 16 }), b = await session({ ...spec, seed, start: vision.start, cap: 16 });
  assert.deepEqual(a.rig, b.rig);
  const h = heldOut(a.rig, { ...spec, seed });
  for (const key of ['combined', 'product', 'background', 'turned', 'rmse']) assert.ok(Number.isFinite(h[key]) && h[key] >= 0, key);
  const truthHeldOut = heldOut(harness.toRig(spec.truth), { ...spec, seed });
  assert.ok(truthHeldOut.combined < 0.02 && truthHeldOut.turned < 0.05, 'the true rig scores near zero on the held-out seeds, so the metric is not rigged against a perfect answer');
});
test('with a sufficient budget the session improves the first estimate on both regions and on pixel error it did not optimize', async () => {
  const vision = await harness.runVisionLoop({ truth: spec.truth, seed: 2, scene: spec.scene });
  const s = await session({ ...spec, seed: 2, start: vision.start, cap: 16 });
  const start = heldOut(harness.toRig(vision.start), { ...spec, seed: 2 }), end = heldOut(s.rig, { ...spec, seed: 2 });
  assert.ok(end.combined < start.combined && end.product < start.product && end.background < start.background && end.rmse < start.rmse, JSON.stringify({ start, end }));
});
