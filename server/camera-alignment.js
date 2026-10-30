// Camera-alignment helper: landmark and silhouette overlay data model plus a small pose/projection check.
// EXPERIMENTAL (research E05): validated only on injected fixtures and the projection convention already used by
// photo.projectBounds. It has NOT been compared with real KeyShot renders of a calibration target, so projection
// conventions, lens distortion and shifted lenses remain unverified. It is not wired into the app and changes no scene.
// Pose convention (identical to photo.js): az/el in degrees, dist from pivot to eye, fov horizontal in degrees, pivot in world units.
const { coordinateSearch, powellSearch } = require('./derivative-free');
const { inPolygon } = require('./image-mask');

const rad = d => d * Math.PI / 180;
function axes(pose) {
  const a = rad(pose.az), e = rad(pose.el);
  return { right: [Math.cos(a), 0, -Math.sin(a)], up: [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)],
    forward: [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const finiteVec = (v, n = 3) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
function validPose(p) { return finiteVec(p?.pivot) && [p.az, p.el, p.dist, p.fov].every(Number.isFinite) && p.dist > 0 && p.fov >= 5 && p.fov <= 120; }

// World point -> normalized image coordinates (x right, y down, both 0..1 across the frame). null when behind the camera.
function projectPoint(world, pose, aspect = 16 / 9) {
  if (!validPose(pose) || !finiteVec(world) || !(aspect >= 0.25 && aspect <= 4)) return null;
  const { right, up, forward } = axes(pose), q = world.map((v, i) => v - pose.pivot[i]);
  const depth = pose.dist - dot(q, forward);
  if (!(depth > 0.001)) return null;
  const tan = Math.tan(rad(pose.fov) / 2);
  return { x: 0.5 + dot(q, right) / (2 * depth * tan), y: 0.5 - dot(q, up) / (2 * depth * (tan / aspect)), depth };
}

// ---- data model -------------------------------------------------------------------------------------------------
// alignment = { version: 1, reference: { width, height, landmarks: [{ id, world: [x,y,z], image: { x, y } }], silhouette?: [[x,y], ...] },
//               render: { pose, aspect } }   image coordinates are normalized 0..1 of the REFERENCE frame (y down).
function createAlignment(input) {
  const ref = input?.reference, landmarks = ref?.landmarks;
  if (!ref || !Array.isArray(landmarks) || landmarks.length > 64) throw new Error('An alignment needs a reference with up to 64 landmarks.');
  const seen = new Set();
  for (const l of landmarks) {
    if (typeof l?.id !== 'string' || !l.id || seen.has(l.id) || !finiteVec(l.world) || !(l.image?.x >= 0 && l.image.x <= 1 && l.image?.y >= 0 && l.image.y <= 1))
      throw new Error('Each landmark needs a unique id, a world point and a normalized image point.');
    seen.add(l.id);
  }
  if (ref.silhouette != null && (!Array.isArray(ref.silhouette) || ref.silhouette.length < 3 || ref.silhouette.length > 128
      || !ref.silhouette.every(p => finiteVec(p, 2) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1))) throw new Error('The silhouette must be 3 to 128 normalized points.');
  if (!validPose(input.render?.pose) || !(input.render?.aspect >= 0.25 && input.render.aspect <= 4)) throw new Error('The render pose or aspect is invalid.');
  return { version: 1, reference: { width: ref.width ?? null, height: ref.height ?? null, landmarks: landmarks.map(l => ({ id: l.id, world: l.world.slice(), image: { x: l.image.x, y: l.image.y } })), ...(ref.silhouette ? { silhouette: ref.silhouette.map(p => p.slice()) } : {}) },
    render: { pose: { ...input.render.pose, pivot: input.render.pose.pivot.slice() }, aspect: input.render.aspect } };
}

// ---- reprojection check -----------------------------------------------------------------------------------------
// Errors are reported in pixels of the given frame (default 1000 px tall so values stay readable without a frame size).
function reprojectionReport(pose, landmarks, aspect, { height = 1000 } = {}) {
  const width = height * aspect;
  const items = landmarks.map(l => {
    const p = projectPoint(l.world, pose, aspect);
    if (!p) return { id: l.id, visible: false, error_px: Infinity };
    return { id: l.id, visible: true, projected: { x: p.x, y: p.y }, observed: l.image, error_px: Math.hypot((p.x - l.image.x) * width, (p.y - l.image.y) * height) };
  });
  const errors = items.map(i => i.error_px), finite = errors.filter(Number.isFinite);
  return { items, rms_px: finite.length === errors.length && errors.length ? Math.sqrt(errors.reduce((n, e) => n + e * e, 0) / errors.length) : Infinity,
    max_px: errors.length ? Math.max(...errors) : Infinity, frame: { width, height } };
}

// Whether the landmarks can constrain a pose at all. Collinear/too-few points are refused; coplanar points cannot separate
// focal length from distance, and symmetric products can look right from a mirrored pose, so those are reported as warnings.
function conditioning(landmarks) {
  const pts = landmarks.map(l => l.world), warnings = [], refusals = [];
  if (landmarks.length < 4) refusals.push('At least four landmarks are needed.');
  const sub = (a, b) => a.map((v, i) => v - b[i]), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let normal = null, coplanar = true, collinear = true;
  if (pts.length >= 3) {
    const d0 = sub(pts[1], pts[0]);
    for (let i = 2; i < pts.length; i++) { const c = cross(d0, sub(pts[i], pts[0])); if (Math.hypot(...c) > 1e-6 * Math.max(1, Math.hypot(...d0) ** 2)) { collinear = false; if (!normal) normal = c; } }
    if (normal) { const n = Math.hypot(...normal); for (const p of pts) if (Math.abs(dot(sub(p, pts[0]), normal)) / n > 1e-6 * Math.max(1, n)) { coplanar = false; break; } }
  }
  if (pts.length >= 3 && collinear) refusals.push('Landmarks are collinear.');
  if (!refusals.length && coplanar) warnings.push('coplanar_landmarks: focal length cannot be separated from camera distance; the field of view stays locked.');
  const screen = landmarks.map(l => l.image), spread = Math.max(...screen.map(p => p.x)) - Math.min(...screen.map(p => p.x));
  if (landmarks.length && spread < 0.2) warnings.push('narrow_screen_spread: landmarks cover under 20% of the frame width.');
  return { ok: !refusals.length, refusals, warnings, coplanar, collinear };
}

// Fit a pose to the training landmarks and report held-out error on the rest. Free parameters default to az, el and dist.
async function fitPose({ initialPose, landmarks, aspect, free = ['az', 'el', 'dist'], heldOut = [], range = {}, budget = 800, method = 'coordinate', height = 1000 }) {
  if (!validPose(initialPose)) throw new Error('The initial pose is invalid.');
  const train = landmarks.filter(l => !heldOut.includes(l.id)), test = landmarks.filter(l => heldOut.includes(l.id));
  const check = conditioning(train);
  if (!check.ok) throw new Error(check.refusals.join(' '));
  const warnings = check.warnings.slice();
  let active = free.slice();
  if (check.coplanar && active.includes('fov')) { active = active.filter(k => k !== 'fov'); warnings.push('fov_locked_ambiguous'); }
  const defaults = { az: range.az ?? 20, el: range.el ?? 20, dist: range.dist ?? 0.5, fov: range.fov ?? 0.4, pivot: range.pivot ?? 0.25 };
  const bounds = [];
  for (const key of active) {
    if (key === 'az' || key === 'el') bounds.push({ name: key, lo: initialPose[key] - defaults[key], hi: initialPose[key] + defaults[key] });
    else if (key === 'dist') bounds.push({ name: key, lo: initialPose.dist * (1 - defaults.dist), hi: initialPose.dist * (1 + defaults.dist) });
    else if (key === 'fov') bounds.push({ name: key, lo: Math.max(5, initialPose.fov * (1 - defaults.fov)), hi: Math.min(120, initialPose.fov * (1 + defaults.fov)) });
    else if (key === 'pivot') for (const [i, axis] of ['x', 'y', 'z'].entries()) bounds.push({ name: 'pivot_' + axis, lo: initialPose.pivot[i] - defaults.pivot * initialPose.dist, hi: initialPose.pivot[i] + defaults.pivot * initialPose.dist });
    else throw new Error('Unknown pose parameter: ' + key);
  }
  const toPose = x => { const pose = { ...initialPose, pivot: initialPose.pivot.slice() }; let i = 0; for (const key of active) { if (key === 'pivot') { pose.pivot = [x[i], x[i + 1], x[i + 2]]; i += 3; } else pose[key] = x[i++]; } return pose; };
  const huber = (e, k = 20) => e <= k ? 0.5 * e * e : k * (e - 0.5 * k);   // robust to one bad landmark
  const loss = x => { const r = reprojectionReport(toPose(x), train, aspect, { height }); return r.items.reduce((n, i) => n + (Number.isFinite(i.error_px) ? huber(i.error_px) : 1e9), 0) / r.items.length; };
  const x0 = active.flatMap(k => k === 'pivot' ? initialPose.pivot : [initialPose[k]]);
  const search = method === 'powell' ? powellSearch : coordinateSearch;
  const found = await search({ x0, bounds, evaluate: async x => loss(x), budget, step0: 0.1, minStep: 0.0002 });
  const pose = toPose(found.x);
  return { pose, free: active, warnings, evaluations: found.evaluations.length,
    before: reprojectionReport(initialPose, train, aspect, { height }), after: reprojectionReport(pose, train, aspect, { height }),
    held_out: test.length ? reprojectionReport(pose, test, aspect, { height }) : null };
}

// ---- silhouette overlay -----------------------------------------------------------------------------------------
function polygonMask(points, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = inPolygon((x + 0.5) / w, (y + 0.5) / h, points) ? 1 : 0;
  return out;
}
function describeMask(mask, w, h) {
  let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { n++; sx += x + 0.5; sy += y + 0.5; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return n ? { area: n / (w * h), centroid: { x: sx / n / w, y: sy / n / h }, bounds: { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h } } : null;
}
function boundary(mask, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[y * w + x - 1] || !mask[y * w + x + 1] || !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x]) pts.push([(x + 0.5) / w, (y + 0.5) / h]);
  }
  return pts;
}
// Overlay of a reference silhouette mask and a render mask on the same w x h grid. `classes` is the drawable overlay:
// 0 neither, 1 reference only, 2 render only, 3 both.
function silhouetteOverlay(reference, render, w, h) {
  if (reference.length !== w * h || render.length !== w * h) throw new Error('Masks must match the overlay grid.');
  const classes = new Uint8Array(w * h); let both = 0, either = 0;
  for (let i = 0; i < classes.length; i++) { const a = reference[i] ? 1 : 0, b = render[i] ? 1 : 0; classes[i] = a | (b << 1); if (a && b) both++; if (a || b) either++; }
  const A = describeMask(reference, w, h), B = describeMask(render, w, h);
  if (!A || !B) return { available: false, reason: 'One of the silhouettes is empty.', classes };
  const bA = boundary(reference, w, h), bB = boundary(render, w, h);
  const nearest = (p, set) => set.reduce((m, q) => Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity);
  const chamfer = (set, other) => set.reduce((n, p) => n + nearest(p, other), 0) / set.length;
  return { available: true, iou: both / either, area_ratio: B.area / A.area,
    centroid_offset: { x: B.centroid.x - A.centroid.x, y: B.centroid.y - A.centroid.y },
    bounds_delta: { x0: B.bounds.x0 - A.bounds.x0, y0: B.bounds.y0 - A.bounds.y0, x1: B.bounds.x1 - A.bounds.x1, y1: B.bounds.y1 - A.bounds.y1 },
    mean_boundary_distance: (chamfer(bA, bB) + chamfer(bB, bA)) / 2, grid: { width: w, height: h }, classes };
}

module.exports = { projectPoint, createAlignment, reprojectionReport, conditioning, fitPose, polygonMask, silhouetteOverlay, describeMask, validPose };
