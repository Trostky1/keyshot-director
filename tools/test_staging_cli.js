const assert = require('node:assert/strict');
const cli = require('../server/cli');
const bridge = require('../server/bridge');
const live = process.argv.includes('--live');
let turn = 0;
if (!live) {
  cli.status = cli.codexStatus = async () => ({ found: true, loggedIn: true, path: 'test-cli' });
  cli.ask = async ({ system, prompt }) => {
    for (const name of ['scene_objects','move_object','duplicate_object','create_set_piece','undo_staging']) assert.ok(system.includes(name));
    assert.ok(system.includes('native scene units'));
    assert.ok(system.includes('ADDITIONAL copies'));
    if (++turn === 1) return JSON.stringify({ calls: [{ name: 'scene_objects', input: {} }] });
    assert.ok(prompt.includes('707'));
    if (turn === 2) return JSON.stringify({ calls: [{ name: 'duplicate_object', input: { node_id: 707, count: 2, offset: [120,0,0], linked_materials: true } }] });
    return JSON.stringify({ say: 'Two linked copies created.', calls: [] });
  };
}
const agent = require('../server/agent');
(async () => {
  const invoked = [];
  const actions = { setAttachments() {},
    async scene_objects(input) { invoked.push('scene_objects'); return live ? bridge.send('scene_objects', input, 30000) : { objects: [{ node_id: 707, name: 'Phone', kind: 5, size: [90,130,100] }], scene: { unit: 'mm' } }; },
    async duplicate_object(input) {
      if (live) throw new Error('Live CLI verification is read-only. Do not change the scene.');
      invoked.push('duplicate_object'); assert.equal(input.node_id, 707); assert.equal(input.count, 2); assert.equal(input.linked_materials, true);
      return { summary: 'Two copies created', objects: [{ node_id: 708 }, { node_id: 709 }] };
    }
  };
  const job = { events: [] };
  await agent.run(job, { text: live ? 'Read-only verification: call scene_objects and inspect my current product and scene units. Explain in two sentences which new staging tools would move or duplicate the whole product and which would add a pedestal. Do not make any changes, do not call look, do not render or save.' : 'Duplicate the whole phone twice with linked materials, 120 mm apart.' }, actions);
  assert.ok(!job.events.some(e => e.type === 'error'), JSON.stringify(job.events.filter(e => e.type === 'error')));
  assert.ok(job.events.filter(e => e.type === 'result').every(e => e.ok));
  assert.ok(invoked.includes('scene_objects'));
  if (!live) assert.deepEqual(invoked, ['scene_objects','duplicate_object']);
  console.log(live ? 'PASS signed-in CLI reads live scene and understands staging tools' : 'PASS CLI staging schemas, instructions, ID selection and ordered tool results');
  console.log(job.events.filter(e => e.type === 'text').map(e => e.text).join('\n'));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
