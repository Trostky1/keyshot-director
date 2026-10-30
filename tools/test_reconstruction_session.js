// Milestone 1 (single-view, CAD-first reconstruction): every stage against injected adapters and a synthetic renderer.
// No KeyShot, bridge, network or real photograph is involved, so none of this is live validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createReconstructor, settings, rigFrom, diagnose, MAX_FREE_PARAMETERS } = require('../server/reconstruction');
const { projectPoint } = require('../server/camera-alignment');
const objectives = require('../server/lighting-objectives');
const synthetic = require('./synthetic_renderer');
const { createFixture, OUTLINE, POSE, TRUTH_RIG, image } = require('./reconstruction_fixture');

// A start that is clearly wrong but inside the search ranges.
const WRONG_START = { lights: [
  { id: 'key', start: { az: -85, el: 22, d: 3, size: 2, power: 2.0 }, free: ['az', 'el', 'power'] },
  { id: 'fill', start: { az: 60, el: 10, d: 3.5, size: 2.5, power: 0.1 }, free: ['power'] }] };
const run = async (fixture, extra = {}, reference = null) => {
  const r = createReconstructor(fixture.deps);
  await r.start({ image: image(reference || fixture.referenceFor()), outline: OUTLINE, rig: WRONG_START, ...extra });
  return { r, status: await r.wait() };
};
const box = [[-120, 0, -60], [-120, 0, 60], [-120, 260, -60], [-120, 260, 60], [120, 0, -60], [120, 0, 60], [120, 260, -60], [120, 260, 60], [0, 130, 60], [-60, 260, 0], [100, 60, -60]];
const landmarksFor = pose => box.map((world, i) => { const p = projectPoint(world, pose, 1); return { id: 'L' + i, world, image: { x: p.x, y: p.y } }; });

test('settings: outline required, six free parameters at most, Area only, materials locked, bounded budgets', () => {
  const ok = { outline: OUTLINE };
  assert.throws(() => settings({}), /product outline/);
  assert.throws(() => settings({ outline: { kind: 'rect' } }), /product outline/);
  assert.throws(() => settings({ ...ok, fit_materials: true }), /Materials stay locked/);
  assert.throws(() => settings({ ...ok, max_evaluations: 41 }), /from 9 to 40/);
  assert.throws(() => settings({ ...ok, max_evaluations: 3 }), /from 9 to 40/);
  assert.throws(() => settings({ ...ok, max_seconds: 5 }));
  assert.throws(() => settings({ ...ok, camera: { policy: 'verify', landmarks: [] } }), /at least four landmarks/);
  assert.equal(settings(ok).max_evaluations, 40); assert.equal(settings(ok).rig.free_parameters, 6);
  const seven = { lights: [{ id: 'key', start: WRONG_START.lights[0].start, free: ['az', 'el', 'power', 'size', 'd'] }, { id: 'fill', start: WRONG_START.lights[1].start, free: ['power', 'az'] }] };
  assert.throws(() => rigFrom(seven), new RegExp(`between 1 and ${MAX_FREE_PARAMETERS}`));
  assert.throws(() => rigFrom({ lights: [{ id: 'a', type: 'spotlight', start: WRONG_START.lights[0].start, free: ['az'] }] }), /Only Area/);
  assert.throws(() => rigFrom({ lights: [{ ...WRONG_START.lights[0] }, { ...WRONG_START.lights[0] }] }), /unique/);
  assert.throws(() => rigFrom({ lights: [{ id: 'a', start: { ...WRONG_START.lights[0].start, az: 400 }, free: ['az'] }] }), /start az/);
  assert.throws(() => rigFrom({ lights: [] }));
});

test('end to end: baseline, camera lock, bounded physical-mode fit, before/after files, receipt and undo', async t => {
  const f = createFixture(); t.after(f.cleanup);
  const { r, status } = await run(f);
  assert.equal(status.phase, 'complete', status.error);
  const x = status.result;
  assert.equal(x.outcome, 'improved'); assert.equal(x.kept, 'fitted_lighting'); assert.equal(x.power_mode, 'physical'); assert.deepEqual(x.materials, { locked: true, geometry_changed: false });
  assert.ok(x.scores.after.combined < x.scores.before.combined / 4, `${x.scores.before.combined} -> ${x.scores.after.combined}`);
  assert.ok(x.scores.after.product < x.scores.before.product && x.scores.after.background < x.scores.before.background, 'product and background improve separately');
  assert.ok(x.budget.evaluations_used <= 40 && x.budget.renders.fit === x.budget.evaluations_used);
  assert.equal(x.budget.renders_total, f.state.renders); assert.equal(x.budget.renders.baseline, 2); assert.equal(x.budget.renders.after, 1);
  assert.ok(x.search.parameters.length <= 6 && x.search.parameters.includes('key.az'));
  assert.ok(Math.abs(x.search.best[0] - -40) < 12 && Math.abs(x.search.best[1] - 45) < 12, `key az/el ${x.search.best.slice(0, 2)}`);
  assert.equal(f.state.applied, 1, 'one full apply, then lightweight updates'); assert.ok(f.state.updates >= x.budget.evaluations_used);
  assert.equal(f.state.lastPlan.power_mode, 'physical');
  for (const slot of ['reference', 'before', 'after', 'difference', 'report', 'recipe']) assert.ok(fs.existsSync(r.file(status.id, slot)), slot);
  const receipt = f.deps.receipts.get(status.id);
  assert.equal(receipt.kind, 'scene_reconstruction'); assert.equal(receipt.status, 'complete'); assert.equal(receipt.restore.status, 'available');
  assert.equal(receipt.last_accepted_recipe.label, 'final'); assert.ok(receipt.owned.some(o => o.kind === 'light'));
  assert.ok(receipt.operations.some(o => o.op === 'camera_locked'));
  assert.deepEqual(status.camera.status, 'locked_unverified'); assert.ok(x.diagnosis.some(d => d.kind === 'camera_unverified'));
  assert.equal(status.canUndo, true);
  await r.undo(); assert.equal(f.state.rig, f.state.original); assert.equal(f.deps.receipts.get(status.id).restore.status, 'complete');
});

test('no cheating: the report separates product and background and never produces a percentage', async t => {
  const f = createFixture(); t.after(f.cleanup);
  const { status } = await run(f);
  const keys = []; const walk = v => { if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) { keys.push(k); walk(c); } }; walk(status.result);
  assert.equal(keys.some(k => /percent|similarity|match_?score|accuracy/i.test(k)), false, 'no field reports a match percentage');
  assert.match(status.result.scores.note, /not a similarity percentage/);
  assert.ok(status.result.scores.components.background_after && status.result.scores.components.after);
});

test('a start already at the truth stops early on measured noise and keeps the original scene', async t => {
  const f = createFixture({ original: TRUTH_RIG }); t.after(f.cleanup);   // the user's own lighting already equals the reference
  const r = createReconstructor(f.deps);
  await r.start({ image: image(f.referenceFor()), outline: OUTLINE, patience: 5 }); const status = await r.wait();
  assert.equal(status.phase, 'complete', status.error);
  assert.equal(status.result.outcome, 'unchanged'); assert.equal(status.result.kept, 'original_scene');
  assert.ok(status.result.budget.evaluations_used < 40, `used ${status.result.budget.evaluations_used}`);
  assert.equal(status.result.budget.stop_reason, 'patience');
  assert.equal(f.state.restored, 1); assert.equal(f.state.rig, f.state.original); assert.equal(status.canUndo, false);
  assert.equal(f.deps.receipts.get(status.id).restore.status, 'complete');
});

test('slow renders cap the evaluations below 40 before anything is changed, and refuse when nothing useful fits', async t => {
  const slow = createFixture({ renderMs: 40_000 }); t.after(slow.cleanup);
  const r = createReconstructor(slow.deps);
  await r.start({ image: image(slow.referenceFor()), outline: OUTLINE, rig: WRONG_START, max_seconds: 60 }); const s = await r.wait();
  assert.equal(s.phase, 'complete'); assert.equal(s.result.outcome, 'insufficient_budget'); assert.match(s.result.message, /allows only/);
  assert.equal(slow.state.applied, 0); assert.equal(slow.state.renders, 2, 'only the two baseline renders were spent');
  assert.equal(slow.deps.receipts.get(s.id).restore.status, 'not_needed');
  const mid = createFixture({ renderMs: 6_000 }); t.after(mid.cleanup);
  const m = createReconstructor(mid.deps);
  await m.start({ image: image(mid.referenceFor()), outline: OUTLINE, rig: WRONG_START, max_seconds: 300 }); const ms = await m.wait();
  assert.ok(ms.result.budget.evaluation_cap < 40 && ms.result.budget.evaluation_cap >= 9, `cap ${ms.result.budget.evaluation_cap}`);
  assert.ok(ms.result.budget.evaluations_used <= ms.result.budget.evaluation_cap);
});

test('the time limit stops the search but still re-validates finalists and keeps the best valid result', async t => {
  const f = createFixture({ renderMs: 4_000, hiddenMs: 3_500 }); t.after(f.cleanup);   // updates cost more than the plan assumed
  const r = createReconstructor(f.deps);
  await r.start({ image: image(f.referenceFor()), outline: OUTLINE, rig: WRONG_START, max_seconds: 150, patience: 20 }); const s = await r.wait();
  assert.equal(s.phase, 'complete', s.error);
  assert.equal(s.result.budget.stop_reason, 'budget'); assert.ok(s.result.budget.evaluations_used < s.result.budget.evaluation_cap);
  assert.ok(s.result.search.finalists.length >= 1, 'finalists were still checked at final quality');
  assert.ok(s.result.scores.after.combined <= s.result.scores.before.combined + 1e-9 || s.result.outcome === 'unchanged');
});

test('camera: locked as is; verified with matching landmarks; correction proposed only on request and applied only after confirmation', async t => {
  const lm = landmarksFor(POSE);
  const verified = createFixture(); t.after(verified.cleanup);
  const v = await run(verified, { camera: { landmarks: lm } });
  assert.equal(v.status.camera.status, 'verified'); assert.equal(v.status.camera.verified, true); assert.ok(!v.status.result.diagnosis.some(d => d.kind === 'camera_unverified'));
  assert.equal(verified.state.calls.includes('applyPose'), false);

  const wrong = { ...POSE, az: POSE.az + 6, el: POSE.el - 5, dist: POSE.dist * 1.12 };
  const verify = createFixture(); t.after(verify.cleanup); verify.state.pose = { ...wrong };
  const noCorrection = await run(verify, { camera: { policy: 'verify', landmarks: lm } });
  assert.equal(noCorrection.status.camera.status, 'needs_correction'); assert.ok(noCorrection.status.camera.proposal.held_out_rms_px < 8);
  assert.equal(verify.state.calls.includes('applyPose'), false, 'verify never moves the camera');

  const propose = createFixture(); t.after(propose.cleanup); propose.state.pose = { ...wrong };
  const pr = createReconstructor(propose.deps);
  await pr.start({ image: image(propose.referenceFor()), outline: OUTLINE, rig: WRONG_START, camera: { policy: 'propose', landmarks: lm } });
  for (let i = 0; i < 400 && pr.status().phase !== 'awaiting_camera'; i++) await new Promise(res => setTimeout(res, 5));
  assert.equal(pr.status().phase, 'awaiting_camera'); assert.equal(pr.status().camera.status, 'correction_proposed');
  assert.equal(propose.state.applied, 0); assert.equal(propose.state.calls.includes('applyPose'), false, 'nothing is applied before confirmation');
  pr.confirmCamera(true); const done = await pr.wait();
  assert.equal(done.phase, 'complete', done.error); assert.equal(done.camera.status, 'corrected');
  assert.ok(Math.abs(propose.state.pose.az - POSE.az) < 1 && Math.abs(propose.state.pose.el - POSE.el) < 1);
  assert.throws(() => pr.confirmCamera(true), /No camera correction/);

  const decline = createFixture(); t.after(decline.cleanup); decline.state.pose = { ...wrong };
  const dr = createReconstructor(decline.deps);
  await dr.start({ image: image(decline.referenceFor()), outline: OUTLINE, rig: WRONG_START, camera: { policy: 'propose', landmarks: lm } });
  for (let i = 0; i < 400 && dr.status().phase !== 'awaiting_camera'; i++) await new Promise(res => setTimeout(res, 5));
  dr.confirmCamera(false); const declined = await dr.wait();
  assert.equal(declined.camera.status, 'correction_declined'); assert.equal(decline.state.calls.includes('applyPose'), false);
});

test('an incompatible reference is rejected before any lighting budget is spent or scene change made', async t => {
  const f = createFixture(); t.after(f.cleanup);
  const lm = landmarksFor(POSE).map((l, i) => ({ ...l, image: { x: (i * 0.37) % 1, y: (i * 0.61) % 1 } }));   // landmarks that no pose explains
  const { status } = await run(f, { camera: { policy: 'verify', landmarks: lm } });
  assert.equal(status.phase, 'reference_incompatible'); assert.match(status.error, /does not fit this product and camera/);
  assert.equal(f.state.applied, 0); assert.equal(f.state.calls.includes('restore'), false);
  const receipt = f.deps.receipts.get(status.id); assert.equal(receipt.status, 'failed'); assert.equal(receipt.restore.status, 'not_needed');
  assert.equal(f.deps.receipts.unresolved().length, 0, 'nothing to recover: no change was made');
});

test('a scene or camera change mid-fit stops without restoring over it, and blocks the next job until reviewed', async t => {
  for (const kind of ['scene', 'camera']) {
    const f = createFixture(); t.after(f.cleanup);
    f.state.onRender = s => { if (s.renders > 12) { if (kind === 'scene') s.sceneId = 'scene-B'; else s.pose = { ...s.pose, az: s.pose.az + 3 }; } };
    const { r, status } = await run(f);
    assert.equal(status.phase, 'stopped_scene_changed', kind); assert.match(status.error, /Nothing was restored automatically/);
    assert.equal(f.state.restored, 0, 'never restore into a scene that is no longer ours');
    const receipt = f.deps.receipts.get(status.id); assert.equal(receipt.restore.status, 'failed');
    await assert.rejects(() => r.start({ image: image(f.referenceFor()), outline: OUTLINE }), error => error.status === 409);
    const listed = await r.recovery(); assert.equal(listed.items.length, 1);
    if (kind === 'scene') {
      await assert.rejects(() => r.resolveRecovery(status.id, 'restore'), error => error.status === 409 && /not the one this job changed/.test(error.message));
      f.state.sceneId = 'scene-A'; f.state.onRender = null;
      assert.deepEqual(await r.resolveRecovery(status.id, 'restore'), { resolved: 'restored' });
      assert.equal(f.state.restored, 1); assert.equal(f.deps.receipts.unresolved().length, 0);
    } else assert.deepEqual(await r.resolveRecovery(status.id, 'dismiss'), { resolved: 'dismissed' });
  }
});

test('cancellation restores the starting scene and records it', async t => {
  const f = createFixture(); t.after(f.cleanup);
  const r = createReconstructor(f.deps); let stopped = false;
  f.state.onRender = s => { if (s.renders === 10 && !stopped) { stopped = true; r.stop(); } };
  await r.start({ image: image(f.referenceFor()), outline: OUTLINE, rig: WRONG_START }); const s = await r.wait();
  assert.equal(s.phase, 'canceled'); assert.equal(f.state.restored, 1); assert.equal(f.state.rig, f.state.original);
  assert.equal(f.deps.receipts.get(s.id).restore.status, 'complete'); assert.equal(f.deps.receipts.get(s.id).status, 'canceled');
});

test('a failed restore leaves a receipt that blocks the next job', async t => {
  const f = createFixture(); t.after(f.cleanup);
  f.deps.restore = async () => { throw new Error('KeyShot busy'); };
  let n = 0; f.state.onRender = () => { if (++n === 10) throw new Error('renderer died'); };
  const { r, status } = await run(f);
  assert.match(status.error, /Restoration needs retry/); assert.equal(f.deps.receipts.get(status.id).restore.status, 'failed');
  await assert.rejects(() => r.start({ image: image(f.referenceFor()), outline: OUTLINE }), error => error.status === 409);
});

test('a photo job awaiting review also blocks a reconstruction (shared safety)', async t => {
  const f = createFixture(); t.after(f.cleanup);
  f.deps.blockers = () => [{ job_id: 'photo_1', kind: 'photo_match', status: 'running' }];
  const r = createReconstructor(f.deps);
  await assert.rejects(() => r.start({ image: image(f.referenceFor()), outline: OUTLINE }), error => error.status === 409 && error.recovery[0].job_id === 'photo_1');
});

test('explicit native save: needs an improved result, new absolute paths, an acknowledgement for .bip, and verifies the files', async t => {
  const f = createFixture(); t.after(f.cleanup);
  const { r, status } = await run(f); assert.equal(status.result.outcome, 'improved');
  const out = name => path.join(f.dir, name);
  await assert.rejects(() => r.deliver({}), error => error.status === 400);
  await assert.rejects(() => r.deliver({ bip: out('a.bip') }), error => /acknowledge_save_as/.test(error.message));
  await assert.rejects(() => r.deliver({ ksp: 'relative.ksp' }), error => error.status === 400);
  await assert.rejects(() => r.deliver({ ksp: out('a.txt') }), error => error.status === 400);
  await assert.rejects(() => r.deliver({ ksp: path.join(f.dir, 'missing', 'a.ksp') }), error => error.status === 400);
  assert.equal(f.state.calls.includes('saveScene'), false, 'validation happens before KeyShot is asked to save');
  fs.writeFileSync(out('exists.ksp'), 'x');
  await assert.rejects(() => r.deliver({ ksp: out('exists.ksp') }), error => error.status === 409 && /never overwrites/.test(error.message));
  const package_ = await r.deliver({ ksp: out('look.ksp') });
  assert.equal(package_.ok, true); assert.equal(package_.verified.ksp.exists, true); assert.equal(package_.open_scene_changed, false); assert.match(package_.note, /not been done/);
  const both = await r.deliver({ bip: out('look.bip'), acknowledge_save_as: true });
  assert.equal(both.open_scene_changed, true, 'a Save As that retargets the open document is reported, not hidden');
  assert.ok(f.deps.receipts.get(status.id).operations.filter(o => o.op === 'native_save').length === 2);
  f.state.sceneId = 'scene-C';
  await assert.rejects(() => r.deliver({ ksp: out('other.ksp') }), error => error.status === 409 && /Nothing was saved/.test(error.message));
});

test('there is nothing to save after an unchanged result or while running', async t => {
  const f = createFixture({ original: TRUTH_RIG }); t.after(f.cleanup);
  const r = createReconstructor(f.deps);
  await assert.rejects(() => r.deliver({ ksp: path.join(f.dir, 'x.ksp') }), error => error.status === 409);
  await r.start({ image: image(f.referenceFor()), outline: OUTLINE, patience: 5 }); await r.wait();
  await assert.rejects(() => r.deliver({ ksp: path.join(f.dir, 'x.ksp') }), error => error.status === 409 && /no improved reconstruction/i.test(error.message));
});

test('residual diagnosis classifies suspects as advice only and does not change the scene', () => {
  const sharp = synthetic.render(TRUTH_RIG, { seed: 1, quality: 'final' }), mask = new Uint8Array(sharp.w * sharp.h).fill(1);
  const score = (reference, render) => objectives.scoreRegions(reference, render, { productMask: Uint8Array.from(mask, (_, i) => ((i % sharp.w) - 20) ** 2 + (((i / sharp.w) | 0) - 20) ** 2 < 81 ? 1 : 0) });
  const recolour = score(synthetic.render(TRUTH_RIG, { scene: { albedo: [0.45, 0.62, 0.8] }, seed: 2, quality: 'final' }), synthetic.render(TRUTH_RIG, { scene: { albedo: [0.82, 0.55, 0.42] }, seed: 3, quality: 'final' }));
  const kinds = r => diagnose({ product: r.product, background: r.background, camera: { verified: false, status: 'locked_unverified' } }).map(d => d.kind);
  assert.ok(kinds(recolour).includes('material_or_white_balance'));
  assert.ok(kinds(recolour).includes('camera_unverified'));
  const twoHighlights = score(synthetic.render({ lights: [{ az: -40, el: 45, gain: 1 }, { az: 150, el: 30, gain: 1 }] }, { seed: 2, quality: 'final' }), synthetic.render({ lights: [{ az: -40, el: 45, gain: 1 }] }, { seed: 3, quality: 'final' }));
  assert.ok(diagnose({ product: twoHighlights.product, background: twoHighlights.background, camera: { verified: true } }).every(d => typeof d.advice === 'string' && d.advice.length > 10));
  const verifiedCamera = diagnose({ product: recolour.product, background: recolour.background, camera: { verified: true, status: 'verified' } });
  assert.ok(!verifiedCamera.some(d => d.kind === 'camera_unverified'));
});
