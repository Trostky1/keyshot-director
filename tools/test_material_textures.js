const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const textures = require('../server/material-textures');

test('recognizes common texture channel names consistently across platforms', () => {
  const cases = [
    ['Asset_BaseColor_4K.jpg', 'base-color'],
    ['Asset_Roughness.png', 'roughness'],
    ['Asset_NormalDX.tif', 'normal'],
    ['Asset_AmbientOcclusion.jpg', 'ambient-occlusion'],
    ['Asset_Displacement.exr', 'displacement'],
    ['Asset_Preview1.png', 'preview (not a shader map)'],
    ['Asset.mtlx', 'MaterialX metadata (reference only)'],
  ];
  for (const [filename, expected] of cases) assert.equal(textures.roleFor(filename), expected, filename);
});

test('reads MaterialX only as a non-executable conversion hint', () => {
  const recipe = `<materialx version="1.38">
    <tiledimage name="base" type="ND_image_color3"><input name="file" type="filename" value="albedo.png" colorspace="srgb_texture"/></tiledimage>
    <standard_surface name="surface" type="surfaceshader">
      <input name="base_color" type="color3" nodename="base" output="base_out"/>
      <input name="specular_roughness" type="float" value="0.42"/>
    </standard_surface>
    <output name="base_out" type="color3" nodename="base"/>
  </materialx>`;
  const result = textures.materialXSummary(recipe);
  assert.equal(result.version, '1.38');
  assert.equal(result.imageNodes[0].file, 'albedo.png');
  assert.deepEqual(result.connections, [{ input: 'base_color', source: 'base' }]);
  assert.equal(result.note.includes('not executed'), true);
  assert.throws(() => textures.materialXSummary('<not-materialx/>'), /invalid or too large/);
});

test('release package source includes the texture converter, bridge and workflow skills', () => {
  const root = path.resolve(__dirname, '..');
  for (const file of [
    'bridge/cc_materials.py',
    'server/material-textures.js',
    'skills/material-lab/SKILL.md',
    'skills/reference-video/SKILL.md',
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, `Missing release dependency: ${file}`);
  const packager = fs.readFileSync(path.join(root, 'package.ps1'), 'utf8');
  for (const file of ['bridge\\cc_materials.py', 'server\\material-textures.js', 'skills\\material-lab\\SKILL.md', 'skills\\reference-video\\SKILL.md'])
    assert.equal(packager.includes(file), true, `Packager does not include ${file}`);
});
