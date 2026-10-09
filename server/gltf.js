// gltf.js - minimal glTF 2.0 writer (no deps). Single self-contained .gltf (buffer embedded as a data URI).
// Units: glTF is metres, Y-up, right-handed. Callers pass scene units (mm) and `unitScale` (0.001) converts.
const fs = require('fs');

const F32 = 5126, U16 = 5123, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

function cubeGeometry(h) {
  // 24 verts (flat normals), 36 indices, half-extent h
  const faces = [
    [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach((f, i) => {
    for (let k = 1; k <= 4; k++) { pos.push(f[k][0] * h, f[k][1] * h, f[k][2] * h); nor.push(...f[0]); }
    const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

/**
 * spec = {
 *   unitScale: 0.001,
 *   nodes: [{ name, t:[x,y,z], q:[x,y,z,w], s:[x,y,z], mesh: bool, camera: {yfov,znear,zfar,aspect}|null, children:[idx] }],
 *   roots: [idx],                       // default: every node that is nobody's child
 *   animations: [{ name, channels: [{ node: idx, path: 'translation'|'rotation'|'scale', times:[s], values:[flat], interp:'LINEAR'|'STEP' }] }]
 *   dummyHalfExtent: 0.5                // in scene units (mm)
 * }
 */
function build(spec) {
  const u = spec.unitScale == null ? 0.001 : spec.unitScale;
  const chunks = [];          // {buf: Buffer, view index}
  const bufferViews = [], accessors = [];
  let offset = 0;
  const addView = (typed, target) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const view = { buffer: 0, byteOffset: offset, byteLength: buf.length }; if (target) view.target = target;
    bufferViews.push(view); chunks.push(buf); offset += buf.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (typed, type, comp, target, minmax) => {
    const count = typed.length / { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const a = { bufferView: addView(typed, target), componentType: comp, count, type };
    if (minmax) { a.min = minmax[0]; a.max = minmax[1]; }
    accessors.push(a); return accessors.length - 1;
  };
  const bounds = (arr, n) => {
    const mn = Array(n).fill(Infinity), mx = Array(n).fill(-Infinity);
    for (let i = 0; i < arr.length; i += n) for (let k = 0; k < n; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); }
    return [mn, mx];
  };

  // shared dummy mesh
  let meshIndex = null;
  const meshes = [], materials = [];
  const needMesh = spec.nodes.some(n => n.mesh);
  if (needMesh) {
    const g = cubeGeometry((spec.dummyHalfExtent == null ? 0.5 : spec.dummyHalfExtent) * u);
    const p = addAccessor(g.pos, 'VEC3', F32, ARRAY_BUFFER, bounds(g.pos, 3));
    const nn = addAccessor(g.nor, 'VEC3', F32, ARRAY_BUFFER);
    const ii = addAccessor(g.idx, 'SCALAR', U16, ELEMENT_ARRAY_BUFFER);
    materials.push({ name: 'CCA_dummy', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0, roughnessFactor: 1 } });
    meshes.push({ name: 'CCA_dummy_mesh', primitives: [{ attributes: { POSITION: p, NORMAL: nn }, indices: ii, material: 0 }] });
    meshIndex = 0;
  }

  const cameras = [];
  const nodes = spec.nodes.map(n => {
    const o = { name: n.name };
    if (n.t) o.translation = n.t.map(x => x * u);
    if (n.q) o.rotation = n.q;
    if (n.s) o.scale = n.s;
    if (n.mesh) o.mesh = meshIndex;
    if (n.camera) {
      const c = n.camera;
      cameras.push({ type: 'perspective', name: n.name + '_cam', perspective: { yfov: c.yfov, znear: (c.znear || 1) * u, zfar: (c.zfar || 100000) * u, ...(c.aspect ? { aspectRatio: c.aspect } : {}) } });
      o.camera = cameras.length - 1;
    }
    if (n.children && n.children.length) o.children = n.children;
    return o;
  });
  const isChild = new Set(); spec.nodes.forEach(n => (n.children || []).forEach(c => isChild.add(c)));
  const roots = spec.roots || spec.nodes.map((_, i) => i).filter(i => !isChild.has(i));

  const animations = (spec.animations || []).map(a => {
    const samplers = [], channels = [];
    for (const ch of a.channels) {
      const times = Float32Array.from(ch.times);
      const comps = ch.path === 'rotation' ? 4 : 3;
      const vals = Float32Array.from(ch.path === 'translation' ? ch.values.map(v => v * u) : ch.values);
      const input = addAccessor(times, 'SCALAR', F32, null, bounds(times, 1));
      const output = addAccessor(vals, comps === 4 ? 'VEC4' : 'VEC3', F32, null);
      samplers.push({ input, output, interpolation: ch.interp || 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } });
    }
    return { name: a.name || 'CCA_anim', samplers, channels };
  });

  const bin = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'KeyShot Director' },
    scene: 0, scenes: [{ nodes: roots }], nodes,
    ...(meshes.length ? { meshes, materials } : {}),
    ...(cameras.length ? { cameras } : {}),
    ...(animations.length ? { animations } : {}),
    accessors, bufferViews,
    buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  };
  return gltf;
}

function write(file, spec) {
  const g = build(spec);
  fs.writeFileSync(file, JSON.stringify(g), 'utf8');
  return { file, nodes: g.nodes.length, animations: (g.animations || []).length, bytes: fs.statSync(file).size };
}

module.exports = { build, write };
