// Stage A (research E14, offline half): persistent job receipts and restart conflicts. No scene is queried or changed;
// "restart" is simulated by building a second director over the same receipt directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createDirector } = require('../server/photo');
const { createReceiptStore, reconcile } = require('../server/job-receipt');
const { encodePng } = require('./png_fixture');

const png = encodePng(64, 64, () => [180, 180, 180]);
const image = 'data:image/png;base64,' + png.toString('base64');
const baseSnapshot = { subject: { center: [0, 0, 0], size: [1, 1, 1], span: 1, models: ['Product'] }, camera: { az: 0 }, checkpoint: { name: 'cam' },
  environment: { hdri: 'x' }, lights: { original: { hidden: false } }, selectOnly: true, scene_context: { huge: 'x'.repeat(5000) }, studio: { exposure: 1 } };
function tmp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-receipt-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function rig(t, root, overrides = {}) {
  const calls = [];
  const receipts = createReceiptStore({ root });
  let sceneId = 'scene-A';
  const deps = { root, receipts, sceneIdentity: async () => sceneId, inventory: async () => [],
    snapshot: async () => JSON.parse(JSON.stringify(baseSnapshot)), capture: async file => fs.writeFileSync(file, png),
    apply: async (plan, opts) => { opts.declareOwned?.({ kind: 'light', id: 'photo_' + opts.id + '_photo_1' }); calls.push(['apply', plan.power_mode]);
      return { lights: [{ id: 'photo_' + opts.id + '_photo_1', material: 'mat' }] }; },
    restore: async state => calls.push(['restore', state.createdIds]), ask: async () => ({ plan: { lights: [{ gain: 1 }] }, engine: 'stub' }), ...overrides };
  return { director: createDirector(deps), receipts, calls, setScene: id => { sceneId = id; } };
}

test('receipts are written atomically with schema, initial state and no scene_context', async t => {
  const root = tmp(t), r = rig(t, root);
  const { id } = await r.director.start({ image, quality: 'quick' }); await r.director.wait();
  const receipt = r.receipts.get(id);
  assert.equal(receipt.schema, 1); assert.equal(receipt.status, 'complete'); assert.equal(receipt.scene_identity, 'scene-A');
  assert.deepEqual(receipt.initial_state.lights, baseSnapshot.lights); assert.equal(receipt.initial_state.scene_context, undefined);
  assert.equal(receipt.restore.status, 'available');
  assert.ok(receipt.owned.some(o => o.kind === 'light' && o.evidence === 'bridge_receipt'));
  assert.equal(receipt.last_accepted_recipe.label, 'final');
  assert.deepEqual(receipt.operations.map(o => o.op), ['apply_first_look']);
  assert.ok(!fs.readdirSync(path.join(root, id)).some(f => f.endsWith('.tmp')));
});
test('power_mode requested for a job reaches the applied plan and the saved recipe', async t => {
  const root = tmp(t), r = rig(t, root);
  const { id } = await r.director.start({ image, quality: 'quick', refinement: { power_mode: 'physical' } }); await r.director.wait();
  assert.deepEqual(r.calls[0], ['apply', 'physical']);
  assert.equal(JSON.parse(fs.readFileSync(r.director.file(id, 'recipe'))).power_mode, 'physical');
  const plain = rig(t, tmp(t)); const second = await plain.director.start({ image, quality: 'quick' }); await plain.director.wait();
  assert.equal(JSON.parse(fs.readFileSync(plain.director.file(second.id, 'recipe'))).power_mode, 'artistic');
});
test('a receipt failure before the first scene change stops the job without touching the scene', async t => {
  const root = tmp(t), r = rig(t, root, { receipts: { unresolved: () => [], begin() { throw new Error('disk full'); } } });
  await r.director.start({ image, quality: 'quick' }); await r.director.wait();
  assert.equal(r.director.status().phase, 'failed'); assert.match(r.director.status().error, /disk full/);
  assert.equal(r.calls.length, 0);
});
test('ownership is declared before creation, so an interrupted apply still records what it may have made', async t => {
  const root = tmp(t);
  const r = rig(t, root, { apply: async (plan, opts) => { opts.declareOwned({ kind: 'light', id: 'photo_x_photo_1' }); throw new Error('bridge crashed'); } });
  const { id } = await r.director.start({ image, quality: 'quick' }); await r.director.wait();
  const receipt = r.receipts.get(id);
  assert.deepEqual(receipt.owned.map(o => [o.kind, o.id, o.evidence]), [['light', 'photo_x_photo_1', 'declared']]);
  assert.equal(receipt.status, 'failed'); assert.equal(receipt.restore.status, 'complete');
  assert.equal(receipt.operations.at(-1).ok, false);
});
test('a failed restore leaves an unresolved receipt that blocks a restarted app from starting over the scene', async t => {
  const root = tmp(t);
  const r = rig(t, root, { apply: async (plan, opts) => { opts.declareOwned({ kind: 'light', id: 'owned_1' }); throw new Error('apply failed'); },
    restore: async () => { throw new Error('KeyShot busy'); } });
  const { id } = await r.director.start({ image, quality: 'quick' }); await r.director.wait();
  assert.equal(r.receipts.get(id).restore.status, 'failed');
  // "restart": a fresh director over the same directory
  const restarted = rig(t, root);
  await assert.rejects(() => restarted.director.start({ image, quality: 'quick' }), error => error.status === 409 && /did not finish/.test(error.message) && error.recovery[0].job_id === id);
  assert.equal(restarted.calls.length, 0);
  const listed = await restarted.director.recovery();
  assert.equal(listed.items[0].job_id, id); assert.deepEqual(listed.items[0].owned, [{ kind: 'light', id: 'owned_1', evidence: 'declared' }]);
});
test('a job that died mid-run is found as running after restart; restore requires the same scene and removes only recorded items', async t => {
  const root = tmp(t), dead = createReceiptStore({ root });
  dead.begin({ job_id: '1_aaaaaaaa', kind: 'photo_match', scene_identity: 'scene-A', initial_state: { ...baseSnapshot, createdIds: [] } });
  dead.recordOwned('1_aaaaaaaa', { kind: 'light', id: 'photo_1_aaaaaaaa_photo_1', evidence: 'declared' });
  const r = rig(t, root);
  assert.equal((await r.director.recovery()).items[0].status, 'running');
  r.setScene('scene-B');
  await assert.rejects(() => r.director.resolveRecovery('1_aaaaaaaa', 'restore'), error => error.status === 409 && /not the one this job changed/.test(error.message));
  assert.equal(r.calls.length, 0, 'a different scene is never overwritten');
  r.setScene('scene-A');
  assert.deepEqual(await r.director.resolveRecovery('1_aaaaaaaa', 'restore'), { resolved: 'restored' });
  assert.deepEqual(r.calls, [['restore', ['photo_1_aaaaaaaa_photo_1']]]);
  assert.equal(dead.get('1_aaaaaaaa').status, 'recovered'); assert.equal(dead.get('1_aaaaaaaa').restore.status, 'complete');
  assert.equal(dead.unresolved().length, 0);
  await r.director.start({ image, quality: 'quick' });   // no longer blocked
  await r.director.wait();
});
test('a receipt without a recorded scene identity can only be dismissed, never restored', async t => {
  const root = tmp(t), store = createReceiptStore({ root });
  store.begin({ job_id: '2_bbbbbbbb', kind: 'photo_match', scene_identity: null, initial_state: baseSnapshot });
  const r = rig(t, root);
  await assert.rejects(() => r.director.resolveRecovery('2_bbbbbbbb', 'restore'), error => error.status === 409);
  assert.deepEqual(await r.director.resolveRecovery('2_bbbbbbbb', 'dismiss'), { resolved: 'dismissed' });
  assert.equal(store.get('2_bbbbbbbb').status, 'dismissed'); assert.equal(r.calls.length, 0);
});
test('unreadable receipts block new jobs instead of being ignored', async t => {
  const root = tmp(t); fs.mkdirSync(path.join(root, '3_cccccccc')); fs.writeFileSync(path.join(root, '3_cccccccc', 'receipt.json'), '{ torn');
  const r = rig(t, root);
  await assert.rejects(() => r.director.start({ image, quality: 'quick' }), error => error.status === 409 && error.recovery[0].unreadable === true);
});
test('session undo marks the receipt restored', async t => {
  const root = tmp(t), r = rig(t, root);
  const { id } = await r.director.start({ image, quality: 'quick' }); await r.director.wait();
  await r.director.undo();
  assert.equal(r.receipts.get(id).restore.status, 'complete');
});
test('reconcile never infers ownership from a name prefix', () => {
  const receipt = { scene_identity: 'S', owned: [{ kind: 'light', id: 'photo_1', node_ids: ['n1'] }] };
  const result = reconcile(receipt, { scene_identity: 'S', inventory: [{ kind: 'light', id: 'photo_1' }, { kind: 'light', id: 'photo_2', name: 'photo_2' }, { kind: 'light', id: 'other', node_id: 'n1' }] }, { lookalikePrefixes: ['photo_'] });
  assert.deepEqual(result.owned_present.map(o => o.id), ['photo_1']);
  assert.deepEqual(result.unowned_present.map(i => [i.id, i.name_lookalike]), [['photo_2', true]], 'a lookalike is reported, never adopted');
  assert.ok(result.conflicts.includes('unowned_lookalikes_present'));
  assert.deepEqual(result.allowed_actions, ['restore', 'dismiss']);
  const other = reconcile(receipt, { scene_identity: 'T', inventory: [] });
  assert.deepEqual(other.allowed_actions, ['dismiss']); assert.ok(other.conflicts.includes('scene_changed') && other.conflicts.includes('owned_items_missing'));
});
test('store validates inputs and bounds the operation log', t => {
  const store = createReceiptStore({ root: tmp(t) });
  assert.throws(() => store.begin({ job_id: '../escape', kind: 'x' }));
  store.begin({ job_id: 'job_1', kind: 'x' });
  assert.throws(() => store.begin({ job_id: 'job_1', kind: 'x' }), /already exists/);
  assert.throws(() => store.recordOwned('job_1', { kind: 'planet', id: 'x' }));
  for (let i = 0; i < 450; i++) store.recordOperation('job_1', { op: 'step', ok: true });
  const receipt = store.get('job_1'); assert.equal(receipt.operations.length, 400); assert.equal(receipt.operations_dropped, 50);
  assert.equal(receipt.operations.at(-1).seq, 450);
});
