// What the Codex/Claude CLI engines read: tool results and viewport captures must not look like the user talking, and the
// request being answered is the newest real user message (found live: replies answered an older request and asked what
// to do with "this image" - the model's own viewport capture).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { renderForCli } = require('../server/agent');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const conversation = [
  { role: 'user', content: [{ type: 'text', text: 'Move the camera a little higher and closer' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'a1', name: 'set_camera', input: { elevation: 10, relative: true } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: '{"summary":"camera set"}' }] }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Raised the camera.' }] },
  { role: 'user', content: [{ type: 'text', text: 'Make the lighting warmer' }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'look', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } }, { type: 'text', text: '{"summary":"viewport captured"}' }] }] },
  { role: 'user', content: '[Director recovery] Your last reply described a scene change but contained no tool call.' },
];

test('the newest real user request is restated, never a tool result or a Director recovery note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd_transcript_'));
  try {
    const { transcript, current } = renderForCli(conversation, dir);
    assert.equal(current, 'Make the lighting warmer');
    assert.match(transcript, /USER: Move the camera a little higher and closer/);
    assert.match(transcript, /USER \(newest request\): Make the lighting warmer/);
    assert.equal((transcript.match(/newest request/g) || []).length, 1, 'marked once, where it stands - not restated after the results');
    assert.match(transcript, /TOOL RESULTS \(from Director, not the user\): RESULT of call b1/);
    assert.match(transcript, /\[viewport capture returned by the tool, not sent by the user: /);
    assert.match(transcript, /DIRECTOR NOTE: \[Director recovery\]/);
    assert.doesNotMatch(transcript, /USER\/TOOLS/);
    assert.equal(fs.readdirSync(dir).filter(name => /^img_\d+\.jpg$/.test(name)).length, 1, 'the capture is still written for the model to read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a false "I could not" after Director already moved the camera is replaced by what really happened', async t => {
  const cli = require('../server/cli'), agent = require('../server/agent');
  const original = { status: cli.status, codexStatus: cli.codexStatus, ask: cli.ask };
  const replies = [
    { say: 'Raising the camera.', calls: [{ name: 'set_camera', input: { elevation: 5, distance: -20, relative: true } }] },
    { say: 'I couldn’t apply the camera move because the live camera control wasn’t callable in this turn.', calls: [] },
  ];
  cli.status = cli.codexStatus = async () => ({ found: true, loggedIn: true, path: 'test-cli' });
  cli.ask = async () => JSON.stringify(replies.shift());
  agent.history.length = 0;
  t.after(() => { Object.assign(cli, original); agent.history.length = 0; });
  const calls = [];
  const actions = { setAttachments() {}, async scene_context() { return { read_only: true, target: { selection: [] } }; },
    async set_camera(input) { calls.push(input); return { summary: 'camera set: elevation 77→82°, distance 394→374 mm' }; } };
  const job = { events: [] };
  await agent.run(job, { text: 'Move the camera a little higher and closer' }, actions);
  const said = job.events.filter(e => e.type === 'text').map(e => e.text);
  assert.equal(calls.length, 1);
  assert.ok(said.includes('Done: camera set: elevation 77→82°, distance 394→374 mm.'), said.join(' | '));
  assert.ok(!said.some(text => /couldn’t apply/.test(text)), 'the false refusal is not shown');
  assert.ok(!JSON.stringify(agent.history).includes('wasn’t callable'), 'and it is not kept in history for later requests');
});

function scriptedEngine(t, replies) {
  const cli = require('../server/cli'), agent = require('../server/agent');
  const original = { status: cli.status, codexStatus: cli.codexStatus, ask: cli.ask };
  cli.status = cli.codexStatus = async () => ({ found: true, loggedIn: true, path: 'test-cli' });
  cli.ask = async () => JSON.stringify(replies.length ? replies.shift() : { say: 'Done.', calls: [] });
  agent.history.length = 0;
  t.after(() => { Object.assign(cli, original); agent.history.length = 0; });
  return agent;
}

test('the exact same scene change is not repeated within one request (a camera nudge ran 14 times live)', async t => {
  const nudge = { name: 'set_camera', input: { elevation: 6, distance: -35, relative: true } };
  const agent = scriptedEngine(t, [{ say: 'Raising.', calls: [nudge] }, { say: 'Raising.', calls: [nudge] }, { say: 'Raised the camera.', calls: [] }]);
  const calls = [];
  const actions = { setAttachments() {}, async scene_context() { return { read_only: true }; },
    async set_camera(input) { calls.push(input); return { summary: 'camera set' }; } };
  const job = { events: [] };
  await agent.run(job, { text: 'Move the camera a little higher and closer' }, actions);
  assert.equal(calls.length, 1, 'the camera moved once');
  assert.match(JSON.stringify(agent.history), /Not repeated: set_camera/);
});

test('after the model already applied a preset, its closing sentence does not trigger the preset again', async t => {
  const agent = scriptedEngine(t, [{ say: 'Applying warm luxe.', calls: [{ name: 'apply_rig', input: { name: 'warm_luxe' } }] },
    { say: 'The warm luxury look is in place.', calls: [] }]);
  const rigs = [];
  const actions = { setAttachments() {}, async scene_context() { return { read_only: true, target: { selection: [] } }; },
    async apply_rig(input) { rigs.push(input.name); return { summary: 'Warm luxe: 3 lights' }; }, async look() { return { summary: 'viewport captured' }; } };
  const job = { events: [] };
  await agent.run(job, { text: 'Make the lighting warmer, like a luxury product shot' }, actions);
  assert.deepEqual(rigs, ['warm_luxe']);
});

test('questions are not scene orders; polite requests and verb-first commands still are', () => {
  const { questionOnly } = require('../server/agent');
  for (const q of ['Before building anything: which maps in this set would the build use, and can the gloss map be used for roughness?',
    'Can the gloss map be used for roughness?', 'Which preset would suit glass?', 'What happens if I build this?'])
    assert.equal(questionOnly(q), true, q);
  for (const order of ['Can you make it warmer?', 'Please build a material from this set?', 'Use the gloss map as roughness?',
    'Build a material from this texture set', 'Make the key light softer'])
    assert.equal(questionOnly(order), false, order);
});

test('a Material Lab question gets the model\'s answer, not a "no tool call" error, and builds nothing', async t => {
  const agent = scriptedEngine(t, [{ say: 'The build would use Base Color, Normal and AO. The gloss map is a JPG, so it cannot be inverted into roughness here.', calls: [] }]);
  const built = [];
  const actions = { setAttachments() {}, async scene_context() { return { read_only: true }; },
    async build_material_from_texture_set(input) { built.push(input); return { summary: 'built' }; }, async list_texture_sets() { return { sets: [] }; } };
  const job = { events: [] };
  await agent.run(job, { text: 'Before building anything: which maps in this set would the build use, and can the gloss map be used for roughness?',
    context: { kind: 'texture-set', id: 'set-1' } }, actions, 'material');
  assert.deepEqual(built, [], 'a question never builds');
  assert.ok(!job.events.some(e => e.type === 'error'), JSON.stringify(job.events.filter(e => e.type === 'error')));
  assert.ok(job.events.some(e => e.type === 'text' && /gloss map is a JPG/.test(e.text)));
});

test('a question tells the model to answer without changing the scene; an order does not', async t => {
  const cli = require('../server/cli');
  const agent = scriptedEngine(t, []);
  const systems = [];
  cli.ask = async ({ system }) => { systems.push(system); return JSON.stringify({ say: 'hero_soft would suit it.', calls: [] }); };
  const actions = { setAttachments() {}, async scene_context() { return { read_only: true, target: { selection: [] } }; },
    async apply_rig() { return { summary: 'applied' }; }, async look() { return { summary: 'captured' }; } };
  await agent.run({ events: [] }, { text: 'Which preset would suit a glossy phone like this?' }, actions);
  await agent.run({ events: [] }, { text: 'Apply hero soft lighting' }, actions);
  assert.match(systems[0], /This message is a question, not a request to change the scene/);
  assert.doesNotMatch(systems.at(-1), /This message is a question/);
});

test('a refusal with no action made in this request is left alone for the existing guards', async t => {
  const cli = require('../server/cli'), agent = require('../server/agent');
  const original = { status: cli.status, codexStatus: cli.codexStatus, ask: cli.ask };
  cli.status = cli.codexStatus = async () => ({ found: true, loggedIn: true, path: 'test-cli' });
  cli.ask = async () => JSON.stringify({ say: 'I cannot tell which part you mean. Which one?', calls: [] });
  agent.history.length = 0;
  t.after(() => { Object.assign(cli, original); agent.history.length = 0; });
  const job = { events: [] };
  await agent.run(job, { text: 'What can you see?' }, { setAttachments() {}, async scene_context() { return { read_only: true }; } });
  assert.ok(job.events.some(e => e.type === 'text' && /Which one\?/.test(e.text)));
});

test('an image the user attached is labelled as theirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd_transcript_'));
  try {
    const { transcript, current } = renderForCli([{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg } }, { type: 'text', text: 'Match this photo' }] }], dir);
    assert.match(transcript, /^USER \(newest request\): \[image attached by the user: /);
    assert.equal(current, 'Match this photo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
