const test = require('node:test');
const assert = require('node:assert/strict');
const { compileTexturePlan } = require('../server/material-core');

test('plans a simple Plastic graph with color-space hints and optional AO', () => {
  const plan = compileTexturePlan({ name: '  Stone  ', files: [
    { name: 'Stone_Roughness.png', role: 'roughness' },
    { name: 'Stone_AO.png', role: 'ambient-occlusion' },
    { name: 'Stone_BaseColor.jpg', role: 'base-color' },
    { name: 'Stone_Normal.png', role: 'normal' },
  ] });
  assert.deepEqual(plan.material, { name: 'Stone', model: 'Plastic' });
  assert.deepEqual(plan.maps.map(map => map.role), ['base-color', 'ambient-occlusion', 'roughness', 'normal']);
  assert.equal(plan.maps[0].color_space, 'srgb');
  assert.equal(plan.maps[1].color_space, 'linear');
  assert.ok(plan.graph.nodes.some(node => node.kind === 'Color Composite Multiply'));
  assert.ok(plan.graph.edges.some(edge => edge.from === 'map:normal' && edge.to === 'surface' && edge.input === 'bumpmap'));
});

test('reports paused channels and keeps the usable Base Color map', () => {
  const plan = compileTexturePlan({ name: 'Resin', files: [
    { name: 'BaseColor.jpg', role: 'base-color' },
    { name: 'Metallic.jpg', role: 'metallic' },
    { name: 'Height.exr', role: 'displacement' },
  ] });
  assert.deepEqual(plan.maps.map(map => map.role), ['base-color']);
  assert.deepEqual(plan.skipped.map(file => file.role), ['metallic', 'displacement']);
  assert.ok(plan.skipped.every(file => /outside the Simple Plastic/.test(file.reason)));
});

test('Normal wins over Bump and duplicate inputs are reported', () => {
  const plan = compileTexturePlan({ name: 'Surface', files: [
    { name: 'Bump.png', role: 'bump' },
    { name: 'Normal.png', role: 'normal' },
    { name: 'Roughness-A.png', role: 'roughness' },
    { name: 'Roughness-B.png', role: 'roughness' },
  ] });
  assert.deepEqual(plan.maps.map(map => map.path), ['Roughness-A.png', 'Normal.png']);
  assert.equal(plan.skipped.length, 2);
  assert.equal(plan.warnings.length, 2);
});

test('rejects traversal paths and AO without any usable color or surface map', () => {
  assert.throws(() => compileTexturePlan({ name: 'Stone', files: [{ name: '../outside.png', role: 'base-color' }] }), /Unsafe texture path/);
  assert.throws(() => compileTexturePlan({ name: 'Stone', files: [{ name: 'AO.png', role: 'ambient-occlusion' }] }), /No supported/);
});

test('validates names, file counts, and input size', () => {
  assert.throws(() => compileTexturePlan({ name: ' ', files: [{ name: 'Color.png', role: 'base-color' }] }), /Material name/);
  assert.throws(() => compileTexturePlan({ name: 'Stone', files: [] }), /between 1 and 24/);
  assert.throws(() => compileTexturePlan({ name: 'Stone', files: [{ name: 'x'.repeat(1024 * 1024), role: 'base-color' }] }), /too large/);
});
