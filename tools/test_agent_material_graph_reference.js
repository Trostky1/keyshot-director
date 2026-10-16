const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../server/agent');

test('material agent exposes only the paused-safe simple Plastic builder options', () => {
  const builder = agent.TOOLS.find(tool => tool.name === 'build_material_from_texture_set');
  assert.ok(builder, 'the AI material workflow must be able to call the builder');
  assert.deepEqual(builder.input_schema.required, ['texture_set_id']);
  assert.deepEqual(Object.keys(builder.input_schema.properties).sort(), ['name', 'texture_set_id', 'use_ao']);
  assert.match(builder.description, /simple Plastic/i);
  assert.match(builder.description, /geometry displacement are paused/i);
});

async function build(text, { image = true } = {}) {
  const calls = [];
  const job = { events: [] };
  await agent.run(job, {
    text,
    images: image ? ['attached-reference'] : [],
    context: { kind: 'texture-set', id: 'set-1', name: 'Poliigon Plastic Test', files: [{ name: 'BaseColor.jpg', role: 'base-color' }], missing: [] },
  }, {
    async build_material_from_texture_set(input) {
      calls.push(input);
      return { summary: `Built as ${input.graph_preset}`, graph_preset: input.graph_preset };
    },
  }, 'material');
  return { calls, job };
}

test('material requests with references use the supported simple Plastic builder', async () => {
  const { calls, job } = await build('Create this material from the imported texture set and match the reference graph.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].graph_preset, 'simple_plastic');
  assert.ok(job.events.some(event => event.type === 'result' && event.ok));
});

test('ordinary material creation uses simple Plastic without reference images', async () => {
  const { calls } = await build('Create this material from the imported texture set.', { image: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].graph_preset, 'simple_plastic');
});
