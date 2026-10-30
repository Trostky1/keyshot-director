'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectMaterialBuildInputs } = require('../server/material-build-input');

const files = [
  { name: 'color-1.png', role: 'base-color' },
  { name: 'color-2.png', role: 'base-color' },
  { name: 'normal.png', role: 'normal' },
  { name: 'bump.png', role: 'bump' },
  { name: 'ao.png', role: 'ambient-occlusion' },
];

test('uses the explicitly chosen variant and physical tile size', () => {
  const result = selectMaterialBuildInputs(files, { selected_files: [
    { name: 'color-2.png', role: 'base-color' }, { name: 'normal.png', role: 'normal' }], tile_size_mm: 250 });
  assert.deepEqual(result.recipeFiles.map(file => file.name), ['color-2.png', 'normal.png']);
  assert.equal(result.tile_size_mm, 250);
});

test('rejects forged files, duplicate roles, conflicting detail maps, and invalid sizes', () => {
  const chosen = [{ name: 'color-1.png', role: 'base-color' }];
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: [{ name: '../outside.png', role: 'base-color' }] }), /missing from this texture set/);
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: [...chosen, { name: 'color-2.png', role: 'base-color' }] }), /repeated map role/);
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: [...chosen, { name: 'normal.png', role: 'normal' }, { name: 'bump.png', role: 'bump' }] }), /either a Normal map or a Bump map/);
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: chosen, tile_size_mm: '41' }), /tile size/);
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: chosen, tile_size_mm: 2001 }), /tile size/);
});

test('rejects AO without a usable material map and respects AO off', () => {
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: [{ name: 'ao.png', role: 'ambient-occlusion' }] }), /at least one/);
  assert.throws(() => selectMaterialBuildInputs(files, { selected_files: [{ name: 'ao.png', role: 'ambient-occlusion' }], use_ao: false }), /Invalid or repeated/);
});
