const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../server/cli');
const agent = require('../server/agent');

function setup(t, { reply, context, ask } = {}) {
  const original = { status: cli.status, codexStatus: cli.codexStatus, ask: cli.ask };
  cli.status = cli.codexStatus = async () => ({ found: true, loggedIn: true, path: 'test-cli' });
  cli.ask = ask || (async () => JSON.stringify({ say: reply || 'I can’t access live KeyShot controls in this turn.', calls: [] }));
  agent.history.length = 0;
  t.after(() => {
    cli.status = original.status;
    cli.codexStatus = original.codexStatus;
    cli.ask = original.ask;
    agent.history.length = 0;
  });
  const calls = [];
  const actions = {
    setAttachments() {},
    async scene_context() {
      if (context instanceof Error) throw context;
      return context || { schema: '1.0', read_only: true, target: { selection: [] } };
    },
    async apply_rig(input) { calls.push(['apply_rig', input]); return { summary: 'Dramatic color: 3 lights', rig: input.name }; },
    async frame_product(input) { calls.push(['frame_product', input]); return { summary: 'Selected-part framing updated' }; },
    async look() { calls.push(['look', {}]); return { summary: 'viewport captured' }; },
    async get_state() { calls.push(['get_state', {}]); return { summary: 'Live state returned', bridge_alive: true }; },
    async scene_objects() { calls.push(['scene_objects', {}]); return { summary: 'Scene inventory returned' }; },
    async set_camera(input) { calls.push(['set_camera', input]); return { summary: 'Camera updated' }; },
  };
  return { actions, calls };
}

test('an advice-only CLI refusal falls back to the unambiguous colored-edge rig and checks the viewport', async t => {
  const context = { schema: '1.0', read_only: true, target: { selection: [
    { name: 'Selected group', path: ['Product', 'Selected group'], hidden: false, bounds: [[-10, 0, -5], [10, 20, 5]] },
  ] } };
  const { actions, calls } = setup(t, {
    context,
    reply: 'I can’t access the live KeyShot controls in this turn, so I haven’t changed the scene. The attached fresh scene snapshot shows a selected group, but not enough surface detail to identify specific features. For colored edge lighting, the closest starting rig is color_drama; I’d check the live viewport and tune the colored edges from there.',
  });
  const job = { events: [] };
  await agent.run(job, { text: 'Please make dramatic colored edge lighting around the selected group.' }, actions);

  assert.deepEqual(calls.map(([name]) => name), ['apply_rig', 'look']);
  assert.equal(calls[0][1].name, 'color_drama');
  assert.equal(calls[0][1].use_selected_part, true);
  assert.ok(job.events.some(event => event.type === 'result' && event.name === 'apply_rig' && event.ok));
  assert.ok(job.events.some(event => event.type === 'result' && event.name === 'look' && event.ok));
  assert.ok(!job.events.some(event => event.type === 'error' || /can't access live KeyShot controls/i.test(event.text || '')));
});

test('an informational question does not apply a lighting rig', async t => {
  const { actions, calls } = setup(t, { reply: 'Colored edge lighting can create a dramatic outline.' });
  const job = { events: [] };
  await agent.run(job, { text: 'What would a colored edge setup look like?' }, actions);

  assert.deepEqual(calls, []);
  assert.ok(job.events.some(event => event.type === 'text' && /dramatic outline/.test(event.text)));
});

test('negative prompts never trigger fallback lighting or a forced tool-call retry', async t => {
  let attempts = 0;
  const { actions, calls } = setup(t, { ask: async () => {
    attempts++;
    return JSON.stringify({ say: 'Moody lighting would reduce fill and deepen the shadows.', calls: [] });
  } });
  const job = { events: [] };
  await agent.run(job, { text: 'No moody lighting; don’t change anything, just explain the current look.' }, actions);

  assert.deepEqual(calls, []);
  assert.equal(attempts, 1);
  assert.ok(!job.events.some(event => event.type === 'error'));
  assert.ok(job.events.some(event => event.type === 'text' && /deepen the shadows/.test(event.text)));
});

test('a real clarification question prevents the lighting fallback from guessing', async t => {
  const { actions, calls } = setup(t, { reply: 'Would you like the colored edge light to be cyan or magenta?' });
  const job = { events: [] };
  await agent.run(job, { text: 'Please add dramatic colored edge lighting.' }, actions);

  assert.deepEqual(calls, []);
  assert.ok(job.events.some(event => event.type === 'text' && /cyan or magenta/.test(event.text)));
});

test('an unavailable scene context reports the bridge failure instead of pretending tools are absent', async t => {
  const { actions, calls } = setup(t, { context: new Error('The local bridge stopped responding.') });
  const job = { events: [] };
  await agent.run(job, { text: 'Please make dramatic colored edge lighting.' }, actions);

  assert.deepEqual(calls, []);
  assert.ok(job.events.some(event => event.type === 'error' && /local bridge stopped responding/i.test(event.message)));
});

test('conflicting direct rig cues do not get guessed by the fallback', async t => {
  const { actions, calls } = setup(t, { reply: 'Please choose either the moody rig or a clean catalog setup.' });
  const job = { events: [] };
  await agent.run(job, { text: 'Please make a moody dark scene with a clean white catalog background.' }, actions);

  assert.deepEqual(calls, []);
});

test('a failed provider turn completes cleanly and does not block the next prompt', async t => {
  let attempts = 0;
  const { actions, calls } = setup(t, { ask: async () => {
    attempts++;
    if (attempts === 1) throw new Error('simulated CLI process exit');
    if (attempts === 2) return JSON.stringify({ say: '', calls: [{ name: 'get_state', input: {} }] });
    return JSON.stringify({ say: 'The live rig state is available.', calls: [] });
  } });
  const failed = { events: [] };
  await agent.run(failed, { text: 'Move the product left twenty millimeters.' }, actions);
  assert.equal(failed.done, true);
  assert.ok(failed.events.some(event => event.type === 'error' && /simulated CLI process exit/.test(event.message)));

  const next = { events: [] };
  await agent.run(next, { text: 'What is my current rig?' }, actions);
  assert.equal(next.done, true);
  assert.deepEqual(calls, [['get_state', {}]]);
  assert.ok(next.events.some(event => event.type === 'result' && event.name === 'get_state' && event.ok));
});

test('an advice-only provider answer gets one tool-call repair before any no-op error', async t => {
  let attempts = 0;
  const { actions, calls } = setup(t, { ask: async ({ prompt }) => {
    attempts++;
    if (attempts === 1) return JSON.stringify({ say: '', calls: [{ name: 'scene_objects', input: {} }] });
    if (attempts === 2) return JSON.stringify({ say: 'I would set the camera to a three-quarter view.', calls: [] });
    if (attempts === 3) {
      assert.match(prompt, /Director recovery/);
      return JSON.stringify({ say: '', calls: [{ name: 'set_camera', input: { azimuth: 35, elevation: 18, distance: 1, fov: 40 } }] });
    }
    return JSON.stringify({ say: 'The camera is set to a three-quarter view.', calls: [] });
  } });
  const job = { events: [] };
  await agent.run(job, { text: 'Please set the camera to a three-quarter hero view.' }, actions);

  assert.equal(job.done, true);
  assert.deepEqual(calls, [
    ['scene_objects', {}],
    ['set_camera', { azimuth: 35, elevation: 18, distance: 1, fov: 40 }],
  ]);
  assert.ok(!job.events.some(event => event.type === 'error'), JSON.stringify(job.events));
  assert.ok(!job.events.some(event => event.type === 'text' && /I would set the camera/.test(event.text)));
  assert.ok(job.events.some(event => event.type === 'result' && event.name === 'set_camera' && event.ok));
});
