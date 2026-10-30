const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
test('release copy manifest includes every literal local JavaScript dependency', () => {
  const source = fs.readFileSync(path.join(root, 'package.ps1'), 'utf8');
  const packaged = new Set();
  for (const match of source.matchAll(/foreach\s*\(\$f in ([\s\S]*?)\)\s*\{\s*Copy-Rel \$f\s*\}/g))
    for (const item of match[1].matchAll(/'([^']+)'/g)) packaged.add(item[1].replace(/\\/g, '/'));
  for (const file of packaged) {
    assert.ok(fs.existsSync(path.join(root, file)), `Missing package source: ${file}`);
    if (!file.endsWith('.js')) continue;
    for (const item of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/require\(['"](\.[^'"]*)['"]\)/g)) {
      const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(file), item[1]));
      const dependency = path.posix.extname(candidate) ? candidate : candidate + '.js';
      assert.ok(packaged.has(dependency), `${file} requires omitted package dependency ${dependency}`);
    }
  }
  for (const file of ['server/photo-refinement.js', 'server/style-search.js', 'docs/MATERIAL_EDIT_RECEIPTS.md', 'docs/MATERIAL_CALIBRATION_PLAN.md', 'docs/MATERIAL_CALIBRATION_RESULTS.md', 'docs/RELEASE_NOTES_2.3.md', 'docs/RELEASE_NOTES_2.4.md', 'server/light-spec.js', 'server/job-receipt.js', 'server/image-mask.js', 'server/colour-contract.js', 'docs/LIGHTING_CAPABILITY_RECORD.md', 'docs/RELEASE_NOTES_REFERENCE_LIGHTING.md', 'server/reconstruction.js', 'server/derivative-free.js', 'server/camera-alignment.js', 'server/lighting-objectives.js', 'bridge/cc_deliver.py', 'docs/RECONSTRUCTION_MILESTONE_1.md'])
    assert.ok(packaged.has(file), `New workflow missing from package: ${file}`);
  assert.ok(packaged.has('server/material-core.js'), 'JavaScript recipe planner must ship in the release');
  assert.ok(packaged.has('server/listen-with-fallback.js'), 'port fallback helper must ship in the release');
  assert.ok(!packaged.has('server/material-core.wasm'), 'end-user releases must not depend on a generated WASM compiler');
  assert.doesNotMatch(source, /cargo\s+build|material-core\.wasm/i, 'release packaging must not require Rust or Cargo');
  const installer = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  assert.match(installer, /server\\material-core\.js/);
  assert.match(installer, /server\\listen-with-fallback\.js/);
  assert.doesNotMatch(installer, /material-core\.wasm/);
});
test('Studio and Materials scripts parse and measurement controls have unique ids', () => {
  const html = fs.readFileSync(path.join(root, 'server/public/index.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(fs.readFileSync(path.join(root, 'server/public/photo-ui.js'), 'utf8'));
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate UI ids');
  for (const id of ['photoRefinementOptions', 'photoMeasureRegion', 'photoObjective', 'photoAttempts', 'photoLocks'])
    assert.ok(ids.includes(id), `Missing measurement control ${id}`);
});
test('the launcher stop script only targets its own recorded Director server', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const stop = fs.readFileSync(path.join(root, 'tools/stop.ps1'), 'utf8');
  assert.match(server, /bridge', 'director-server\.json'/);
  assert.match(server, /started: Date\.now\(\)/);
  assert.match(stop, /bridge\\director-server\.json/);
  assert.match(stop, /server\\server\.js/);
  assert.match(stop, /FromUnixTimeMilliseconds/);
  assert.doesNotMatch(stop, /Get-NetTCPConnection/);
});
