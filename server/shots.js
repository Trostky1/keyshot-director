// shots.js - shot recipes: camera path math, easing, and the player that drives the bridge.
const ease = {
  linear: t => t,
  easeIn: t => t * t * t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  hold: t => (t < 1 ? 0 : 1),          // a cut: stay on the previous key, jump on arrival
};
const lerp = (a, b, t) => a + (b - a) * t;

// A "pose" is orbit-style: pivot + azimuth/elevation (deg) + distance + fov (+ roll later).
function poseToEye(p) {
  const az = (p.az * Math.PI) / 180, el = (p.el * Math.PI) / 180;
  return [
    p.pivot[0] + p.dist * Math.cos(el) * Math.sin(az),
    p.pivot[1] + p.dist * Math.sin(el),
    p.pivot[2] + p.dist * Math.cos(el) * Math.cos(az),
  ];
}

function eyeToPose(eye, pivot, fov) {
  const d = [eye[0] - pivot[0], eye[1] - pivot[1], eye[2] - pivot[2]];
  const dist = Math.hypot(...d);
  return {
    pivot, dist, fov,
    el: (Math.asin(d[1] / dist) * 180) / Math.PI,
    az: (Math.atan2(d[0], d[2]) * 180) / Math.PI,
  };
}

// Recipe v0: { name, duration, fps, keys: [{t:0..1, az, el, dist, fov, ease?}] }  (t normalised)
// Values between keys are interpolated with the *destination* key's easing.
function sample(recipe, base, u) {
  const keys = recipe.keys;
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (u >= keys[i].t && u <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const span = b.t - a.t || 1;
  const f = (ease[b.ease || recipe.ease || 'easeInOut'] || ease.linear)(Math.min(1, Math.max(0, (u - a.t) / span)));
  const pick = (k, name, dflt) => (k[name] !== undefined ? k[name] : dflt);
  const pa = a.pivot || base.pivot, pb = b.pivot || base.pivot;
  return {
    pivot: [lerp(pa[0], pb[0], f), lerp(pa[1], pb[1], f), lerp(pa[2], pb[2], f)],
    az: lerp(pick(a, 'az', base.az), pick(b, 'az', base.az), f),
    el: lerp(pick(a, 'el', base.el), pick(b, 'el', base.el), f),
    dist: lerp(pick(a, 'dist', base.dist), pick(b, 'dist', base.dist), f),
    fov: lerp(pick(a, 'fov', base.fov), pick(b, 'fov', base.fov), f),
  };
}

// Motion presets, relative to the camera the user has now (single source of truth: the UI and the AI both use these).
function presets(b, duration) {
  const d = (x, def) => duration || def || x;
  return {
    orbit_360: { label: 'Orbit 360', duration: d(6), ease: 'linear', keys: [{ t: 0, az: b.az }, { t: 1, az: b.az + 360 }] },
    push_in: { label: 'Slow push-in', duration: d(4), ease: 'easeInOut', keys: [{ t: 0, dist: b.dist * 1.2 }, { t: 1, dist: b.dist * 0.65 }] },
    hero_reveal: { label: 'Hero reveal', duration: d(5), ease: 'easeInOut', keys: [{ t: 0, az: b.az + 70, el: 8, dist: b.dist * 1.25 }, { t: 1, az: b.az - 15, el: 22, dist: b.dist * 0.85 }] },
    crane_up: { label: 'Crane up', duration: d(4), ease: 'easeOut', keys: [{ t: 0, el: 4 }, { t: 1, el: 55 }] },
    whip_settle: { label: 'Whip + settle', duration: d(3), ease: 'easeOut', keys: [{ t: 0, az: b.az + 220, fov: 70 }, { t: 1, az: b.az, fov: b.fov }] },
  };
}

// The pose that fills in whatever a recipe does not key (an orbit keys only azimuth, a crane only elevation). It must be
// the camera the user has NOW: the presets are built from it, and taking elevation/distance/fov from the connect-time
// pose made every preset jump back to that old view on its first frame. Preview and render share this.
function motionDefaults(connectPose, currentPose) {
  return { ...connectPose, ...(currentPose || {}) };
}

// The chat's set_camera: absolute values, or (relative=true) values added to the current camera. A request that would land
// outside the allowed range is refused with the current numbers instead of silently clamped, so a model that misjudged the
// scale (e.g. +3500 mm on a 504 mm camera) can correct itself rather than parking the camera at the 3 m limit, top-down.
const CAMERA_LIMITS = { az: [-1e4, 1e4], el: [-85, 85], dist: [5, 3000], fov: [8, 90] };
function cameraTarget(current, { azimuth, elevation, distance, fov, relative = false } = {}) {
  const round = n => +Number(n).toFixed(2), out = { ...current }, problems = [];
  for (const [key, value, label, unit] of [['az', azimuth, 'azimuth', '°'], ['el', elevation, 'elevation', '°'], ['dist', distance, 'distance', ' mm'], ['fov', fov, 'field of view', '°']]) {
    if (value == null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) { problems.push(`${label} must be a number`); continue; }
    const next = relative ? current[key] + value : value, [lo, hi] = CAMERA_LIMITS[key];
    if (next < lo || next > hi) problems.push(`${label} would be ${round(next)}${unit} (allowed ${lo} to ${hi}${unit})`);
    else out[key] = next;
  }
  if (problems.length) throw Object.assign(new Error(`Camera not moved: ${problems.join('; ')}. Current camera: azimuth ${round(current.az)}°, elevation ${round(current.el)}°, distance ${round(current.dist)} mm, field of view ${round(current.fov)}°.` +
    (relative ? ' With relative=true each value is added to these; a negative distance moves closer.' : '')), { status: 400 });
  return out;
}

// KeyShot's own camera "dist" (lux.getCameraDistance) and "lookat" are not the eye-to-pivot orbit Director's camera tools
// use: in a real scene KeyShot reported 4540 mm for a camera 504 mm from the product, and the chat then moved the camera
// thousands of millimetres. The AI's scene context carries the orbit values set_camera works in; the raw ones are dropped.
function withDirectorCamera(context) {
  const c = context && context.camera;
  if (!c || !Array.isArray(c.pos) || !Array.isArray(c.pivot) || c.pos.length !== 3 || c.pivot.length !== 3 || ![...c.pos, ...c.pivot].every(Number.isFinite)) return context;
  const r2 = n => +n.toFixed(2), pose = eyeToPose(c.pos, c.pivot, Number.isFinite(c.fov) ? c.fov : 40);
  const { dist, lookat, ...camera } = c;
  return { ...context, camera: { ...camera, set_camera_values: { azimuth: r2(pose.az), elevation: r2(pose.el), distance_mm: r2(pose.dist), fov: r2(pose.fov),
    note: 'Current camera in the units set_camera uses (distance = eye to product centre, mm). With relative=true, set_camera adds to these.' } } };
}

module.exports = { ease, poseToEye, eyeToPose, sample, presets, motionDefaults, cameraTarget, CAMERA_LIMITS, withDirectorCamera };
