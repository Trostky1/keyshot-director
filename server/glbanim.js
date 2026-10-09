// glbanim.js - add animation to a GLB that KeyShot exported (parts keep their names), without touching geometry.
// Recipe tracks are OFFSETS from each node's rest pose, in the node's local space (KeyShot exports local units = mm,
// with a lux_root node scaled 0.001, so offsets are plain mm):
//   pos  keys: [dx,dy,dz] added to rest translation
//   rot  keys: euler degrees [x,y,z] applied on top of rest rotation (in parent space)
//   scale keys: [fx,fy,fz] multiplied onto rest scale
const fs = require('fs');
const { compile, eulerToQuat, matToQuat } = require('./anim');

function load(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 4).toString() !== 'glTF') throw new Error('not a GLB');
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
  const binLen = b.readUInt32LE(20 + jl);
  const bin = b.slice(20 + jl + 8, 20 + jl + 8 + binLen);
  return { json, bin };
}

function save(file, json, bin) {
  const pad = (buf, ch) => { const n = (4 - (buf.length % 4)) % 4; return n ? Buffer.concat([buf, Buffer.alloc(n, ch)]) : buf; };
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), bb = pad(bin, 0);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bb.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bb.length, 0); bh.write('BIN\0', 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, j, bh, bb]));
}

// rest TRS of a node (decomposes node.matrix if present)
function restTRS(n) {
  if (!n.matrix) return { t: n.translation || [0, 0, 0], q: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] };
  const m = n.matrix, len = (a, b, c) => Math.hypot(a, b, c);
  const sx = len(m[0], m[1], m[2]), sy = len(m[4], m[5], m[6]), sz = len(m[8], m[9], m[10]);
  const r = [[m[0] / sx, m[4] / sy, m[8] / sz], [m[1] / sx, m[5] / sy, m[9] / sz], [m[2] / sx, m[6] / sy, m[10] / sz]];
  return { t: [m[12], m[13], m[14]], q: matToQuat(r), s: [sx, sy, sz] };
}
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];

/** animateGlb(inFile, outFile, recipe) - recipe.targets keys must be node names in the GLB. Returns a summary. */
function animateGlb(inFile, outFile, recipe) {
  const { json, bin } = load(inFile);
  const byName = new Map();
  json.nodes.forEach((n, i) => { if (!byName.has(n.name)) byName.set(n.name, i); });
  json.nodes.forEach((n, i) => byName.set('#' + i, i));   // '#7' addresses a node by index (names can repeat)
  const missing = Object.keys(recipe.targets).filter(n => !byName.has(n));
  if (missing.length) throw new Error('nodes not in GLB: ' + missing.join(', ') + ' (have: ' + [...byName.keys()].join(', ') + ')');

  const compiled = compile(recipe);
  const chunks = [bin]; let offset = bin.length;
  const addAcc = (typed, type, minmax) => {
    const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length }); chunks.push(buf); offset += buf.length;
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const a = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: typed.length / comps, type };
    if (minmax) { a.min = minmax[0]; a.max = minmax[1]; }
    json.accessors.push(a); return json.accessors.length - 1;
  };

  const rest = new Map();
  const getRest = idx => { if (!rest.has(idx)) { const n = json.nodes[idx]; const r = restTRS(n); delete n.matrix; n.translation = r.t; n.rotation = r.q; n.scale = r.s; rest.set(idx, r); } return rest.get(idx); };
  const samplers = [], channels = [];
  for (const ch of compiled.spec.animations[0].channels) {
    const idx = byName.get(ch.name), r = getRest(idx);
    const v = ch.values, n = ch.times.length; let out;
    if (ch.path === 'translation') out = Float32Array.from({ length: n * 3 }, (_, k) => r.t[k % 3] + v[k]);
    else if (ch.path === 'scale') out = Float32Array.from({ length: n * 3 }, (_, k) => r.s[k % 3] * v[k]);
    else { out = new Float32Array(n * 4); for (let i = 0; i < n; i++) out.set(qmul(v.slice(i * 4, i * 4 + 4), r.q), i * 4); }
    const times = Float32Array.from(ch.times);
    const input = addAcc(times, 'SCALAR', [[times[0]], [times[times.length - 1]]]);
    const output = addAcc(out, ch.path === 'rotation' ? 'VEC4' : 'VEC3');
    samplers.push({ input, output, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: idx, path: ch.path } });
  }
  json.animations = (json.animations || []).concat([{ name: 'CCA_anim', samplers, channels }]);
  const all = Buffer.concat(chunks); json.buffers[0].byteLength = all.length;
  save(outFile, json, all);
  return { summary: compiled.summary, nodesAnimated: [...new Set(compiled.spec.animations[0].channels.map(c => c.name))], bytes: fs.statSync(outFile).size };
}

module.exports = { animateGlb, load, restTRS };
