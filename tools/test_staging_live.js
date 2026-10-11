// Opt-in native integration test: touches the live scene and restores each step.
// Run only with the user's KeyShot scene saved/available and no active jobs.
const assert = require('node:assert/strict');
const bridge = require('../server/bridge');
const send = (op, payload = {}) => bridge.send(op, payload, 60000);
const close = (a, b, tolerance = 0.002) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tolerance, `${v} != ${b[i]}`));
};
async function main() {
  const initial = await send('scene_objects');
  const product = initial.objects.find(n => !n.owned && n.kind === 5 && !n.hidden && !n.locked);
  assert.ok(product, 'No unlocked visible product model');
  const ids = initial.objects.map(n => n.node_id).sort((a,b) => a-b);
  const materialCode = 'result = {str(p.getID()): p.getMaterial() for p in lux.getSceneTree().find() if not p.isDeleted() and (p.isObject() or (p.isGroup() and not p.getChildren()))}';
  const materials = await send('exec', { code: materialCode });
  async function transaction(op, input, check) {
    let completed = false;
    try {
      const result = await send(op, input); completed = true;
      await check(result);
    } finally {
      if (completed) await send('stage_undo');
    }
    const restored = await send('scene_objects');
    assert.equal(restored.undo_count, initial.undo_count);
    assert.deepEqual(restored.objects.map(n => n.node_id).sort((a,b) => a-b), ids);
    for (const old of initial.objects) {
      const current = restored.objects.find(n => n.node_id === old.node_id);
      close(current.bounds[0], old.bounds[0]); close(current.bounds[1], old.bounds[1]);
    }
  }
  await assert.rejects(send('stage_duplicate', { node_id: product.node_id, count: 99 }));
  await assert.rejects(send('stage_transform', { node_id: product.node_id, scale: 0 }));
  await transaction('stage_transform', { node_id: product.node_id, translation: [12,7,-9] }, r => {
    close(r.objects[0].center, product.center.map((v,i) => v + [12,7,-9][i]));
  });
  console.log('PASS assembly translation + exact bounds restore');
  await transaction('stage_transform', { node_id: product.node_id, rotation: [0,90,0], scale: 1.2 }, r => {
    close(r.objects[0].center, product.center);
    close(r.objects[0].size, [product.size[2]*1.2, product.size[1]*1.2, product.size[0]*1.2]);
  });
  console.log('PASS center-relative rotation/scale + restore');
  await transaction('stage_duplicate', { node_id: product.node_id, count: 2, offset: [product.size[0]*1.3,0,0], linked_materials: true }, async r => {
    assert.equal(r.objects.length, 2);
    r.objects.forEach((n,i) => close(n.center, product.center.map((v,j) => v + (j===0 ? product.size[0]*1.3*(i+1) : 0))));
    const sourceMats = await send('exec', { code: `n = [n for n in lux.getSceneTree().find(types=lux.NODE_TYPE_MODEL) if n.getID() == ${product.node_id}][0]\nresult = sorted(set(p.getMaterial() for p in n.find() if p.isObject() or (p.isGroup() and not p.getChildren())))` });
    for (const copy of r.objects) {
      const copyMats = await send('exec', { code: `n = [n for n in lux.getSceneTree().find(types=lux.NODE_TYPE_MODEL) if n.getID() == ${copy.node_id}][0]\nresult = sorted(set(p.getMaterial() for p in n.find() if p.isObject() or (p.isGroup() and not p.getChildren())))` });
      assert.deepEqual(copyMats, sourceMats);
    }
  });
  console.log('PASS whole-product duplication, offsets, linked materials + owned-only removal');
  for (const [kind, size] of [['pedestal',[80,20,80]], ['floor',[300,1,300]], ['backdrop',[300,250,1]]]) {
    await transaction('stage_set', { kind, size, position: [0,-30,0] }, r => {
      assert.ok(r.objects.length);
      close(r.objects[0].size, size); close(r.objects[0].center, [0,-30,0]);
    });
  }
  console.log('PASS physical pedestal/floor/backdrop creation + owned-only removal');
  assert.deepEqual(await send('exec', { code: materialCode }), materials);
  console.log('PASS all original material assignments preserved; scene not saved');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
