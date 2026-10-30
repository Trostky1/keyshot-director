// Deterministic synthetic "renderer" for offline reconstruction experiments. NOT KeyShot and NOT a physical model of it:
// a glossy sphere on a ground plane, lit by up to a few distant sources with Lambert + Blinn-Phong shading and ray-cast
// soft shadows. Linear radiance is exact (independent sources add), display output applies exposure, an sRGB-like curve and
// clipping, and optional seeded noise stands in for render variance. Results from this file say nothing about real renders.
const { linearToSrgb } = require('../server/colour-contract');

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussian(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const dirOf = (az, el) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]; };

const DEFAULT_SCENE = { size: 40, yaw: 0, pitch: 28, albedo: [0.62, 0.62, 0.64], ground: 0.28, shininess: 60, specular: 0.9, ambient: 0.01, exposure: 1, soft: 0.12, shadowSamples: 4 };

// params.lights: [{ az, el, gain, soft? }]. Returns { w, h, linear: Float32Array(3*w*h), display: Float32Array(3*w*h) }.
function renderLinear(params, scene = {}) {
  const s = { ...DEFAULT_SCENE, ...scene }, N = s.size, lights = params.lights || [];
  const radius = 0.55, centre = [0, 0, 0], groundY = -radius;
  const pitch = s.pitch * Math.PI / 180, yaw = s.yaw * Math.PI / 180;
  // orthographic camera looking at the origin; view direction d, plane basis (r, u)
  const d = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const r = norm([Math.cos(yaw), 0, -Math.sin(yaw)]);
  const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
  const view = [-d[0], -d[1], -d[2]];
  const linear = new Float32Array(N * N * 3), mask = new Uint8Array(N * N);   // mask: pixel shows the sphere
  const hitSphere = (o, dir) => {
    const oc = [o[0] - centre[0], o[1] - centre[1], o[2] - centre[2]], b = dot(oc, dir), c = dot(oc, oc) - radius * radius, disc = b * b - c;
    if (disc < 0) return null; const t = -b - Math.sqrt(disc); return t > 1e-4 ? t : null;
  };
  // Soft-shadow samples are seeded per pixel AND per light, so one source's contribution never depends on which other sources are on
  // (exact superposition in linear space, the idealised baseline the light-response experiment starts from).
  const shadow = (p, L, soft, pixel, light) => {
    let lit = 0; const n = Math.max(1, s.shadowSamples);
    const jitter = rng((pixel * 7919) ^ (Math.round(light.az * 100) * 31) ^ Math.round(light.el * 100) ^ 0x5bd1e995);
    for (let k = 0; k < n; k++) {
      const jx = (jitter() - 0.5) * soft * 2, jy = (jitter() - 0.5) * soft * 2;
      const dir = norm([L[0] + jx, L[1] + jy, L[2] + (jitter() - 0.5) * soft * 2]);
      if (hitSphere(p, dir) === null) lit++;
    }
    return lit / n;
  };
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const sx = ((px + 0.5) / N - 0.5) * 2.4, sy = (0.5 - (py + 0.5) / N) * 2.4;
    const o = [r[0] * sx + u[0] * sy + view[0] * 5, r[1] * sx + u[1] * sy + view[1] * 5, r[2] * sx + u[2] * sy + view[2] * 5];
    let rgb = [0, 0, 0];
    const tS = hitSphere(o, d);
    let tG = d[1] < 0 ? (groundY - o[1]) / d[1] : null; if (tG !== null && tG < 0) tG = null;
    if (tS !== null && (tG === null || tS < tG)) {
      mask[py * N + px] = 1;
      const p = [o[0] + d[0] * tS, o[1] + d[1] * tS, o[2] + d[2] * tS], n = norm(p.map((v, i) => v - centre[i]));
      rgb = s.albedo.map(a => a * s.ambient);
      for (const light of lights) {
        const L = dirOf(light.az, light.el), nl = dot(n, L); if (nl <= 0) continue;
        const h = norm([L[0] + view[0], L[1] + view[1], L[2] + view[2]]), spec = s.specular * Math.pow(Math.max(0, dot(n, h)), s.shininess);
        for (let c = 0; c < 3; c++) rgb[c] += light.gain * (s.albedo[c] * nl + spec);
      }
    } else if (tG !== null) {
      const p = [o[0] + d[0] * tG, groundY, o[2] + d[2] * tG];
      if (Math.hypot(p[0], p[2]) < 8) {
        rgb = [s.ground * s.ambient, s.ground * s.ambient, s.ground * s.ambient];
        for (const light of lights) {
          const L = dirOf(light.az, light.el); if (L[1] <= 0.02) continue;
          const v = shadow([p[0], p[1] + 1e-3, p[2]], L, light.soft ?? s.soft, py * N + px, light);
          for (let c = 0; c < 3; c++) rgb[c] += light.gain * s.ground * L[1] * v;
        }
      }
    }
    for (let c = 0; c < 3; c++) linear[(py * N + px) * 3 + c] = rgb[c];
  }
  return { w: N, h: N, linear, mask };
}

// display-referred 0..1 image from linear radiance: exposure, tone curve, clipping, then seeded noise (quality-dependent).
function toDisplay(linearImage, { exposure = 1, noise = 0, seed = 1 } = {}) {
  const r = rng(seed), rgb = new Float32Array(linearImage.linear.length);
  for (let i = 0; i < rgb.length; i++) {
    const v = linearToSrgb(Math.max(0, linearImage.linear[i] * exposure));
    rgb[i] = Math.min(1, Math.max(0, v + (noise ? gaussian(r) * noise : 0)));
  }
  return { w: linearImage.w, h: linearImage.h, rgb, mask: linearImage.mask };
}
const NOISE = { search: 0.012, final: 0.005 };
function render(params, { scene = {}, seed = 1, quality = 'search' } = {}) {
  const lin = renderLinear(params, scene);
  return toDisplay(lin, { exposure: scene.exposure ?? 1, noise: NOISE[quality] ?? NOISE.search, seed });
}

// A renderer that refuses to exceed a hard render budget and counts every call, so comparisons are at equal budget.
function budgeted(budget, { scene = {}, baseSeed = 1000 } = {}) {
  let used = 0;
  return {
    get used() { return used; },
    remaining: () => budget - used,
    render(params, { quality = 'search', sceneOverride = {} } = {}) {
      if (used >= budget) { const e = new Error('Render budget exhausted.'); e.budget = true; throw e; }
      used++;
      return render(params, { scene: { ...scene, ...sceneOverride }, seed: baseSeed + used, quality });
    },
  };
}
module.exports = { renderLinear, toDisplay, render, budgeted, DEFAULT_SCENE, NOISE, rng };
