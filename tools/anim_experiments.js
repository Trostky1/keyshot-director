// anim_experiments.js - run the glTF-route experiments against a live KeyShot (bridge running, EMPTY scene, scene saved).
//   node tools/anim_experiments.js selftest     offline: build glTFs, no KeyShot needed
//   node tools/anim_experiments.js e0           read-only probe (import options, lux names, tree)
//   node tools/anim_experiments.js e1           import a turntable cube, report animation info
//   node tools/anim_experiments.js e2           seek 0/1/2s, report where the cube is (+ screenshots)
//   node tools/anim_experiments.js e4           animated glTF camera import test
//   node tools/anim_experiments.js e5           bind: a pre-existing node 'CC_Product' parented under an animated dummy (see header of e5())
//   node tools/anim_experiments.js nodes        find animation nodes (E8 probe, untested - save first)
//   node tools/anim_experiments.js clean        delete nodes named CCA_*
// Results are printed and appended to bridge/anim/results.log.
const fs = require('fs');
const path = require('path');
const { send, BASE } = require('../server/bridge');
const gltf = require('../server/gltf');
const anim = require('../server/anim');

const OUT = path.join(BASE, 'anim');
fs.mkdirSync(OUT, { recursive: true });
const log = (tag, obj) => {
  const s = `\n## ${new Date().toISOString()} ${tag}\n` + JSON.stringify(obj, null, 1);
  console.log(s); fs.appendFileSync(path.join(OUT, 'results.log'), s + '\n');
};
const T = 60000;

function cubeTurntable(file) {
  const r = anim.merge('CCA_turn', 2, 30,
    anim.moves.turntable({ target: 'CCA_Spin', degrees: 180, duration: 2, ease: 'linear', rest: { pos: [0, 30, 0] } }),
    anim.moves.slide({ target: 'CCA_Slide', from: [60, 0, 0], to: [60, 0, 100], end: 2, ease: 'easeInOut', rest: { pos: [60, 0, 0] } }));
  const c = anim.compile(r); return { c, w: gltf.write(file, c.spec) };
}

async function e0() { log('E0 probe', await send('anim_probe', {}, T)); }
async function e1() {
  const f = path.join(OUT, 'e1_turntable.gltf'); const { c } = cubeTurntable(f);
  log('E1 import ' + c.summary, await send('anim_import', { path: f }, T));
}
async function vis() {
  // visible test: 20mm cube sliding in x across the product's view, spinning; screenshots at 3 times
  await send('anim_delete', {}, T);
  const r = anim.merge('CCA_vis', 2, 30,
    anim.moves.slide({ target: 'CCA_Vis', from: [-90, 30, 0], to: [90, 30, 0], end: 2, ease: 'linear', rest: { pos: [-90, 30, 0] } }),
    { targets: {}, tracks: [{ target: 'CCA_Vis', prop: 'rot', keys: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 180, 0] }] }] });
  const c = anim.compile(r); c.spec.dummyHalfExtent = 10;
  const f = path.join(OUT, 'vis.gltf'); gltf.write(f, c.spec);
  log('VIS import ' + c.summary, await send('anim_import', { path: f }, T).then(x => ({ ...x, tree: undefined })));
  for (const s of [0, 1, 2]) log('VIS t=' + s, await send('anim_time', { secs: s, names: ['CCA_Vis'], shot: 'vis_t' + s }, T));
}
async function e2() {
  const names = ['CCA_Spin', 'CCA_Slide'];
  const res = {};
  for (const s of [0, 1, 2]) res['t=' + s] = await send('anim_time', { secs: s, names, shot: 'e2_t' + s }, T);
  log('E2 seek', res);
}
async function e4() {
  const base = { pivot: [0, 30, 0], az: 0, el: 15, dist: 250, fov: 35 };
  const r = anim.merge('CCA_camtest', 2, 30,
    anim.moves.camera({ target: 'CCA_Cam', base, keys: [{ t: 0, az: 0 }, { t: 2, az: 90, dist: 180 }] }),
    anim.moves.turntable({ target: 'CCA_CamAnchor', degrees: 1, duration: 2, rest: { pos: [0, 0, 0] } }));   // gives the file a mesh (KeyShot needs >=1 object)
  const c = anim.compile(r); const f = path.join(OUT, 'e4_camera.gltf'); gltf.write(f, c.spec);
  log('E4 import ' + c.summary, await send('anim_import', { path: f, camera_import: true }, T));
  const res = {};
  for (const s of [0, 1, 2]) { await send('anim_time', { secs: s, names: [] }, T); res['t=' + s] = await send('get_camera', {}, T); }
  log('E4 camera over time (active camera readback)', res);
}
async function e5() {
  // Prereq: scene contains a part/group named CC_Product (e.g. a cube you made or any model, rename it). Import adds CCA_Spin dummy.
  const before = await send('anim_time', { secs: 0, names: ['CC_Product'] }, T);
  const f = path.join(OUT, 'e1_turntable.gltf'); if (!fs.existsSync(f)) cubeTurntable(f);
  log('E5 import', await send('anim_import', { path: f }, T));
  log('E5 group', await send('anim_group', { group: 'CCA_Spin', children: ['CC_Product'] }, T));
  const res = { before };
  for (const s of [0, 1, 2]) res['t=' + s] = await send('anim_time', { secs: s, names: ['CC_Product', 'CCA_Spin'], shot: 'e5_t' + s }, T);
  log('E5 inheritance (does CC_Product follow CCA_Spin?)', res);
}
async function nodes() { log('nodes', await send('anim_nodes', {}, T)); }
async function clean() { log('clean', await send('anim_delete', {}, T)); }

function selftest() {
  const { c, w } = cubeTurntable(path.join(OUT, 'e1_turntable.gltf'));
  console.log(c.summary, w);
  const g = JSON.parse(fs.readFileSync(w.file, 'utf8'));
  // sanity: each accessor fits its buffer view, animation inputs have min/max
  const bin = Buffer.from(g.buffers[0].uri.split(',')[1], 'base64');
  const sz = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const a of g.accessors) {
    const v = g.bufferViews[a.bufferView], bytes = a.count * sz[a.type] * (a.componentType === 5123 ? 2 : 4);
    if (bytes > v.byteLength || v.byteOffset + v.byteLength > bin.length || (v.byteOffset % 4)) throw new Error('accessor/view mismatch');
  }
  const rot = g.animations[0].channels.find(ch => ch.target.path === 'rotation');
  const out = g.accessors[g.animations[0].samplers[rot.sampler].output];
  const q = new Float32Array(bin.buffer, bin.byteOffset + g.bufferViews[out.bufferView].byteOffset, out.count * 4);
  const last = Array.from(q.slice(-4)).map(x => +x.toFixed(4));
  console.log('last rotation quat (expect ~[0,1,0,0] = 180deg about Y):', last);
  const cam = anim.compile(anim.merge('x', 2, 30, anim.moves.camera({ base: { pivot: [0, 30, 0], az: 0, el: 15, dist: 250, fov: 35 }, keys: [{ t: 0, az: 0 }, { t: 2, az: 90, dist: 180 }] })));
  const ch = cam.spec.animations[0].channels;
  const p0 = ch[0].values.slice(0, 3).map(x => +x.toFixed(1)), p1 = ch[0].values.slice(-3).map(x => +x.toFixed(1));
  console.log('camera path start/end:', p0, p1, 'frames', cam.frames);
  console.log('OK');
}

const cmds = { vis, selftest, e0, e1, e2, e4, e5, nodes, clean };
const cmd = process.argv[2];
if (!cmds[cmd]) { console.log('usage: node tools/anim_experiments.js <' + Object.keys(cmds).join('|') + '>'); process.exit(1); }
Promise.resolve(cmds[cmd]()).catch(e => { log(cmd + ' FAILED', String(e.message || e)); process.exit(1); });
