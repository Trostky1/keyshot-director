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

module.exports = { ease, poseToEye, eyeToPose, sample, presets };
