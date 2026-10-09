// anim.js - animation engine. Recipe (JSON, scene independent) -> dense per-frame tracks -> glTF spec for gltf.js.
// Authored here, rendered by KeyShot. Scene units = mm, angles in degrees, time in seconds.
//
// recipe = {
//   name, duration, fps,
//   targets: { <nodeName>: { type: 'node'|'camera', pos:[x,y,z], rot:[x,y,z] deg, scale:[x,y,z], fov } },   // rest pose
//   tracks: [ { target, prop: 'pos'|'rot'|'scale'|'cam', keys: [{ t, v, ease }] } ]
//            'cam' keys: { t, az, el, dist, pivot?, fov? } (orbit pose, same maths as shots.js; also drives lookAt)
// }
const { ease, poseToEye, sample } = require('./shots');

const RAD = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;

// ---- rotation helpers ------------------------------------------------------------------
function eulerToQuat(r) {            // degrees, applied in Y, X, Z order (yaw, pitch, roll) - matches turntable-style moves
  const [x, y, z] = r.map(d => d * RAD / 2);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
function matToQuat(m) {              // m = 3x3 as [r0,r1,r2] rows
  const t = m[0][0] + m[1][1] + m[2][2]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
  const n = Math.hypot(x, y, z, w); return [x / n, y / n, z / n, w / n];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const n = Math.hypot(...a) || 1; return a.map(x => x / n); };
function lookAtQuat(eye, target, up = [0, 1, 0]) {   // glTF camera looks down -Z, up +Y
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return matToQuat([[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]);
}
function qdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; }
function fixHemisphere(qs) {         // keep consecutive quaternions in the same hemisphere so LINEAR never takes the long way
  for (let i = 1; i < qs.length; i++) if (qdot(qs[i - 1], qs[i]) < 0) qs[i] = qs[i].map(v => -v);
  return qs;
}

// ---- track sampling ----------------------------------------------------------------------
function keyedValue(keys, t, rest, defaultEase) {
  if (!keys.length) return rest;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1]; if (t >= last.t) return last.v;
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const f = (ease[b.ease || defaultEase] || ease.linear)((t - a.t) / (b.t - a.t || 1));
  return a.v.map((x, k) => lerp(x, b.v[k], f));
}

function frameTimes(duration, fps) {
  const n = Math.max(1, Math.round(duration * fps));
  return Array.from({ length: n + 1 }, (_, i) => i / fps);
}

/** compile(recipe) -> { spec (for gltf.write), frames, fps, duration, summary } */
function compile(recipe) {
  const fps = recipe.fps || 30, duration = recipe.duration;
  const times = frameTimes(duration, fps);
  const names = Object.keys(recipe.targets);
  const index = Object.fromEntries(names.map((n, i) => [n, i]));
  const nodes = names.map(n => {
    const T = recipe.targets[n], isCam = T.type === 'camera';
    return { name: n, t: T.pos || [0, 0, 0], q: eulerToQuat(T.rot || [0, 0, 0]), s: T.scale || [1, 1, 1], mesh: !isCam,
      camera: isCam ? { yfov: (T.fov || 40) * RAD, znear: 1, zfar: 200000 } : null };
  });
  const channels = [];
  const byTarget = {};
  for (const tr of recipe.tracks) (byTarget[tr.target] = byTarget[tr.target] || []).push(tr);

  for (const [name, trs] of Object.entries(byTarget)) {
    const T = recipe.targets[name]; if (!T) throw new Error(`track targets unknown node "${name}"`);
    const node = index[name];
    const get = p => trs.find(t => t.prop === p);
    const dflt = recipe.ease || 'easeInOut';
    const cam = get('cam');
    if (cam) {   // orbit pose -> position + lookAt rotation
      const base = { pivot: cam.base.pivot, az: cam.base.az, el: cam.base.el, dist: cam.base.dist, fov: cam.base.fov };
      const keys = cam.keys.map(k => ({ ...k, t: k.t / duration }));          // shots.sample works in 0..1
      const pr = { ease: dflt, keys };
      const poses = times.map(t => sample(pr, base, Math.min(1, t / duration)));
      const pos = [], quat = [];
      poses.forEach(p => { const e = poseToEye(p); pos.push(...e); quat.push(lookAtQuat(e, p.pivot)); });
      fixHemisphere(quat);
      channels.push({ node, path: 'translation', times, values: pos });
      channels.push({ node, path: 'rotation', times, values: quat.flat() });
      continue;
    }
    const pT = get('pos'), pR = get('rot'), pS = get('scale');
    if (pT) channels.push({ node, path: 'translation', times, values: times.flatMap(t => keyedValue(pT.keys, t, T.pos || [0, 0, 0], dflt)) });
    if (pR) {
      const qs = fixHemisphere(times.map(t => eulerToQuat(keyedValue(pR.keys, t, T.rot || [0, 0, 0], dflt))));
      channels.push({ node, path: 'rotation', times, values: qs.flat() });
    }
    if (pS) channels.push({ node, path: 'scale', times, values: times.flatMap(t => keyedValue(pS.keys, t, T.scale || [1, 1, 1], dflt)) });
  }
  channels.forEach(c => { c.name = names[c.node]; });   // lets glbanim.js address existing nodes by name
  return {
    spec: { unitScale: 0.001, nodes, animations: [{ name: recipe.name || 'CCA_anim', channels }] },
    frames: times.length, fps, duration,
    summary: `${recipe.name || 'anim'}: ${names.length} node(s), ${channels.length} channel(s), ${times.length} frames @ ${fps} fps, ${duration}s`,
  };
}

// ---- high-level moves: each returns { targets, tracks } fragments to merge ---------------------------------
const moves = {
  // rotate a node about Y (turntable). The node must be a dummy that the real product is parented under.
  turntable: ({ target, degrees = 360, duration, ease: e = 'linear', start = 0, rest }) =>
    ({ targets: { [target]: { type: 'node', ...(rest || {}) } }, tracks: [{ target, prop: 'rot', keys: [{ t: start, v: [0, 0, 0] }, { t: duration, v: [0, degrees, 0], ease: e }] }] }),
  // push a node from `from` to `to` (mm offsets)
  slide: ({ target, from, to, start = 0, end, ease: e = 'easeInOut', rest }) =>
    ({ targets: { [target]: { type: 'node', ...(rest || {}) } }, tracks: [{ target, prop: 'pos', keys: [{ t: start, v: from }, { t: end, v: to, ease: e }] }] }),
  // fly each part out along its direction vector
  explode: ({ parts, distance = 40, start = 0, end, ease: e = 'easeInOut' }) => {
    const targets = {}, tracks = [];
    for (const p of parts) {
      const d = norm(p.dir), o = p.origin || [0, 0, 0];
      targets[p.name] = { type: 'node', pos: o };
      tracks.push({ target: p.name, prop: 'pos', keys: [{ t: start, v: o }, { t: end, v: [o[0] + d[0] * distance * (p.k || 1), o[1] + d[1] * distance * (p.k || 1), o[2] + d[2] * distance * (p.k || 1)], ease: e }] });
    }
    return { targets, tracks };
  },
  // orbit a light-carrier node around a pivot (as a position track on a dummy)
  lightSweep: ({ target, pivot = [0, 0, 0], radius = 200, height = 120, fromAz = -60, toAz = 60, start = 0, end, ease: e = 'easeInOut', steps = 24 }) => {
    const keys = Array.from({ length: steps + 1 }, (_, i) => {
      const f = i / steps, az = lerp(fromAz, toAz, (ease[e] || ease.linear)(f)) * RAD;
      return { t: lerp(start, end, f), v: [pivot[0] + radius * Math.sin(az), pivot[1] + height, pivot[2] + radius * Math.cos(az)], ease: 'linear' };
    });
    return { targets: { [target]: { type: 'node' } }, tracks: [{ target, prop: 'pos', keys }] };
  },
  // camera pose track from shots.js presets or explicit keys
  camera: ({ target = 'CCA_Camera', base, keys, fov }) =>
    ({ targets: { [target]: { type: 'camera', fov: fov || base.fov } }, tracks: [{ target, prop: 'cam', base, keys }] }),
};

function merge(name, duration, fps, ...frags) {
  const r = { name, duration, fps, targets: {}, tracks: [] };
  for (const f of frags) { Object.assign(r.targets, f.targets); r.tracks.push(...f.tracks); }
  return r;
}

module.exports = { compile, moves, merge, eulerToQuat, lookAtQuat, matToQuat };
